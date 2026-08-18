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

function finishReason(payload: any): string {
  return String(payload?.choices?.[0]?.finish_reason || '').trim().toLowerCase();
}

function hasUnbalancedMarkdownFence(text: string): boolean {
  const ticks = (String(text || '').match(/`/g) || []).length;
  return ticks % 2 !== 0;
}

export function looksAbruptlyCutOff(text: string, reason = ''): boolean {
  const value = String(text || '').trim();
  const normalizedReason = String(reason || '').trim().toLowerCase();
  if (!value) return true;
  if (['length', 'max_tokens', 'max_token', 'token_limit'].includes(normalizedReason)) return true;
  if (hasUnbalancedMarkdownFence(value)) return true;
  if (/[,:;\-–—/\\]$/.test(value)) return true;
  if (/\b(?:and|or|but|because|about|with|to|from|for|the|a|an|this|that|these|those|your|my|our|its)$/i.test(value)) return true;
  return false;
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

  const perform = async (attemptPrompt: string, tokenBudget: number) => {
    const messages = [
      ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt.trim() }] : []),
      { role: 'user', content: noThinkPrompt(attemptPrompt) },
    ];

    const response = await fetchImpl(endpoint.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        thinking_budget_tokens: 0,
        max_tokens: tokenBudget,
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

    return {
      text: sanitizeQwenReply({
        text: extractText(payload),
        latestUserMessage: attemptPrompt,
        maxCharacters: 12_000,
      }).trim(),
      finishReason: finishReason(payload),
    };
  };

  const requestedBudget = maxTokens(options.maxTokens);
  const first = await perform(prompt, requestedBudget);
  if (!first.text) throw new Error('SPMT local LLM returned an empty response.');
  if (!looksAbruptlyCutOff(first.text, first.finishReason)) {
    return { text: first.text, provider: 'spmt-local-qwen', model };
  }

  // Never publish a visibly chopped answer. Regenerate once from the beginning
  // with more headroom; if that is still incomplete, throw so the shared AI
  // provider can use its normal EdenAI fallback instead of showing a fragment.
  const retryPrompt = [
    prompt,
    '',
    'The previous draft ended abruptly before the answer was complete.',
    'Answer again from the beginning. Finish every sentence and close any Markdown you open.',
  ].join('\n');
  const retryBudget = maxTokens(Math.max(requestedBudget * 2, 800));
  const retry = await perform(retryPrompt, retryBudget);
  if (!retry.text || looksAbruptlyCutOff(retry.text, retry.finishReason)) {
    throw new Error(`SPMT local LLM returned an incomplete response${retry.finishReason ? ` (${retry.finishReason})` : ''}.`);
  }

  return {
    text: retry.text,
    provider: 'spmt-local-qwen',
    model,
  };
}
