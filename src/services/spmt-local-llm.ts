import { resolveQwenEndpoint, sanitizeQwenReply } from '@/services/qwen-private-chat';
import {
  DEFAULT_BUILT_IN_QWEN_MODEL,
  getQwenSamplingProfile,
  resolvePreferredBuiltInQwenModel,
} from '@/services/qwen-quality';

const DEFAULT_SPMT_LLM_BASE_URL = 'http://spmt-llm-worker.internal:8080/v1';
const DEFAULT_MAX_TOKENS = 400;
const MAX_MAX_TOKENS = 6000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MIN_REQUEST_TIMEOUT_MS = 5_000;
const MAX_REQUEST_TIMEOUT_MS = 120_000;

export type SpmtLocalLlmOptions = {
  maxTokens?: number;
  temperature?: number;
};

export type SpmtLocalLlmResponse = {
  text: string;
  provider: 'spmt-local-qwen';
  model: string;
};

function configuredBaseUrl(): string {
  return String(
    process.env.SPMT_LLM_BASE_URL ||
    process.env.PRIVATE_QWEN_BASE_URL ||
    DEFAULT_SPMT_LLM_BASE_URL,
  ).trim();
}

function configuredModel(): string {
  return String(
    process.env.SPMT_LLM_MODEL ||
    process.env.PRIVATE_QWEN_MODEL ||
    DEFAULT_BUILT_IN_QWEN_MODEL,
  ).trim();
}

function configuredApiKey(): string {
  // The built-in Fly worker is intentionally private-network only and needs no
  // second model credential. This remains only for an already-supported custom
  // Qwen endpoint that uses PRIVATE_QWEN_API_KEY.
  return String(process.env.PRIVATE_QWEN_API_KEY || '').trim();
}

function requestTimeoutMs(): number {
  const configured = Number(process.env.SPMT_LLM_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.max(MIN_REQUEST_TIMEOUT_MS, Math.min(MAX_REQUEST_TIMEOUT_MS, Math.floor(configured)));
}

function maxTokens(value: number | undefined): number {
  const requested = Number(value || DEFAULT_MAX_TOKENS);
  if (!Number.isFinite(requested)) return DEFAULT_MAX_TOKENS;
  return Math.max(32, Math.min(MAX_MAX_TOKENS, Math.floor(requested)));
}

function noThinkPrompt(prompt: string): string {
  const value = String(prompt || '').trim();
  if (!value) return '';
  return /(^|\n)\s*\/no_think\s*$/i.test(value) ? value : `${value}\n\n/no_think`;
}

function extractText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === 'string' ? part : String(part?.text || part?.content || ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function isSpmtLocalLlmEnabled(): boolean {
  return process.env.SPMT_LOCAL_LLM_ENABLED !== 'false';
}

export async function requestSpmtLocalLlm(
  prompt: string,
  systemPrompt = '',
  options: SpmtLocalLlmOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<SpmtLocalLlmResponse> {
  const baseUrl = configuredBaseUrl();
  const endpoint = resolveQwenEndpoint(baseUrl);
  if (!endpoint.ok) throw new Error(endpoint.error);

  const apiKey = configuredApiKey();
  const model = await resolvePreferredBuiltInQwenModel({
    baseUrl,
    configuredModel: configuredModel(),
    apiKey,
    fetchImpl,
  });
  if (!model) throw new Error('SPMT local LLM model is not configured.');

  const sampling = getQwenSamplingProfile(0, false);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const messages = [
    ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt.trim() }] : []),
    { role: 'user', content: noThinkPrompt(prompt) },
  ];

  const response = await fetchImpl(endpoint.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      thinking_budget_tokens: 0,
      max_tokens: maxTokens(options.maxTokens),
      temperature: options.temperature ?? sampling.temperature,
      top_p: sampling.top_p,
      top_k: sampling.top_k,
      repetition_penalty: sampling.repetition_penalty,
      presence_penalty: sampling.presence_penalty,
      frequency_penalty: sampling.frequency_penalty,
    }),
    signal: typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(requestTimeoutMs())
      : undefined,
  });

  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  if (!response.ok) {
    const detail = String(payload?.error?.message || payload?.error || raw || `HTTP ${response.status}`)
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    throw new Error(`SPMT local LLM returned ${response.status}: ${detail}`);
  }

  const text = sanitizeQwenReply({
    text: extractText(payload),
    latestUserMessage: prompt,
    maxCharacters: 12_000,
  }).trim();
  if (!text) throw new Error('SPMT local LLM returned an empty response.');

  return {
    text,
    provider: 'spmt-local-qwen',
    model,
  };
}
