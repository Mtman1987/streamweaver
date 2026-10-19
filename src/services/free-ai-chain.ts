import { readAICostPolicy } from './ai-cost-policy';
import {
  FreeChatUnavailableError,
  generateFreeGeminiResponse,
  isFreeGeminiConfigured,
} from './free-gemini-chat';
import { isSpmtLocalLlmEnabled, requestSpmtLocalLlm } from './spmt-local-llm';

/**
 * Free-tier fallback chain for shared bot AI.
 *
 * Providers are tried in order. A provider is only used when its key is present
 * (key presence is the opt-in), and each provider cools down on its own, so one
 * rate limit never takes the others offline. Keys are secrets (Fly secrets /
 * env). Order and allowed providers are public runtime config in
 * config/ai-cost-policy.json under `freeChain`.
 */

export type FreeProviderId = 'gemini' | 'groq' | 'cerebras' | 'openrouter' | 'mistral' | 'local';
type Category = ConstructorParameters<typeof FreeChatUnavailableError>[0];

export const DEFAULT_FREE_CHAIN: readonly FreeProviderId[] = [
  'gemini', 'groq', 'cerebras', 'openrouter', 'mistral', 'local',
];

export type FreeChainOptions = {
  maxTokens?: number;
  temperature?: number;
  maxCharacters?: number;
  /** Restrict this call to these providers (e.g. keep private data on one provider). */
  providers?: readonly string[];
  /** Internal monotonic deadline shared by every provider attempt in one turn. */
  deadlineAtMs?: number;
};

type CompatId = 'groq' | 'cerebras' | 'openrouter' | 'mistral';
type CompatSpec = {
  url: string;
  keyEnv: string;
  modelEnv: string;
  defaultModels: string[];
  /** OpenRouter only: refuse any model that is not a ':free' variant so it can never spend credits. */
  requireFreeSuffix?: boolean;
};

// Model IDs change often on free tiers. Override with the *_MODEL env var
// (comma-separated list = tried in order) without a redeploy of code.
const COMPAT: Record<CompatId, CompatSpec> = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyEnv: 'GROQ_API_KEY',
    modelEnv: 'GROQ_MODEL',
    defaultModels: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  },
  cerebras: {
    url: 'https://api.cerebras.ai/v1/chat/completions',
    keyEnv: 'CEREBRAS_API_KEY',
    modelEnv: 'CEREBRAS_MODEL',
    defaultModels: ['gpt-oss-120b', 'qwen-3.8-27b'],
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keyEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    defaultModels: ['openrouter/free'],
    requireFreeSuffix: true,
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    keyEnv: 'MISTRAL_API_KEY',
    modelEnv: 'MISTRAL_MODEL',
    defaultModels: ['mistral-small-latest'],
  },
};

const REQUEST_TIMEOUT_MS = 7_000;
const MAX_MODELS_PER_PROVIDER = 2;
const MAX_CHAIN_DURATION_MS = 35_000;
const AUTH_COOLDOWN_MS = 6 * 60 * 60_000;
const MODEL_MISSING_COOLDOWN_MS = 30 * 60_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 2 * 60_000;
const MIN_QUOTA_COOLDOWN_MS = 30_000;
const MAX_QUOTA_COOLDOWN_MS = 30 * 60_000;
const TRANSIENT_COOLDOWN_MS = 30_000;
const LOCAL_TRANSIENT_COOLDOWN_MS = 5 * 60_000;

const cooldowns = new Map<FreeProviderId, { until: number; category: Category }>();

function capAtCompleteSentence(text: string, limit: number): string {
  const value = String(text || '').trim();
  if (value.length <= limit) return value;
  const candidate = value.slice(0, limit);
  let sentenceEnd = -1;
  for (const match of candidate.matchAll(/[.!?](?:["')\\]}]+)?(?=\\s|$)/g)) {
    sentenceEnd = (match.index || 0) + match[0].length;
  }
  if (sentenceEnd >= Math.floor(limit * 0.6)) return candidate.slice(0, sentenceEnd).trim();
  return `${candidate.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

class ProviderFailure extends Error {
  constructor(readonly category: Category, readonly cooldownMs: number, detail = '') {
    super(detail || category);
    this.name = 'ProviderFailure';
  }
}

function safeDetail(value: string): string {
  return String(value || '')
    .replace(/(x-goog-api-key|authorization|api[_-]?key|token|secret|bearer)\s*[:=]?\s*[^\s,;"]+/gi, '$1=[REDACTED]')
    .replace(/sk-or-v1-[a-zA-Z0-9_-]+|sk-[a-zA-Z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 300);
}

function compatKey(id: CompatId): string {
  return String(process.env[COMPAT[id].keyEnv] || '').trim();
}

function compatModels(id: CompatId): string[] {
  const spec = COMPAT[id];
  const configured = String(process.env[spec.modelEnv] || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  let models = configured.length ? configured : spec.defaultModels;
  if (spec.requireFreeSuffix) models = models.filter((model) => model === 'openrouter/free' || model.endsWith(':free'));
  return Array.from(new Set(models)).slice(0, MAX_MODELS_PER_PROVIDER);
}

function isProviderConfigured(id: FreeProviderId, tenantId?: string): boolean {
  if (id === 'gemini') return isFreeGeminiConfigured(tenantId);
  if (id === 'local') return isSpmtLocalLlmEnabled();
  return Boolean(compatKey(id)) && compatModels(id).length > 0;
}

function resolveChain(allowed?: readonly string[]): FreeProviderId[] {
  const known = new Set<string>(DEFAULT_FREE_CHAIN);
  const fromPolicy = readAICostPolicy().freeChain.filter((id): id is FreeProviderId => known.has(id));
  let order: FreeProviderId[] = fromPolicy.length ? Array.from(new Set(fromPolicy)) : [...DEFAULT_FREE_CHAIN];
  if (allowed) {
    const allow = new Set(allowed);
    order = order.filter((id) => allow.has(id));
  }
  return order;
}

export function isFreeChainConfigured(tenantId?: string, allowed?: readonly string[]): boolean {
  return resolveChain(allowed).some((id) => isProviderConfigured(id, tenantId));
}

/** Safe diagnostics for logs / health pages. Never includes keys. */
export function getFreeChainStatus(tenantId?: string): Array<{
  provider: FreeProviderId;
  configured: boolean;
  coolingDownSeconds: number;
  reason: string;
}> {
  const now = Date.now();
  return resolveChain().map((provider) => {
    const cooldown = cooldowns.get(provider);
    const remaining = cooldown && cooldown.until > now ? Math.ceil((cooldown.until - now) / 1000) : 0;
    return {
      provider,
      configured: isProviderConfigured(provider, tenantId),
      coolingDownSeconds: remaining,
      reason: remaining ? String(cooldown?.category) : '',
    };
  });
}

export function resetFreeChainCooldowns(): void {
  cooldowns.clear();
}

function parseRetryAfterMs(response: Response): number {
  const raw = response.headers.get('retry-after');
  const seconds = Number(raw);
  if (raw && Number.isFinite(seconds) && seconds > 0) {
    return Math.max(MIN_QUOTA_COOLDOWN_MS, Math.min(MAX_QUOTA_COOLDOWN_MS, Math.ceil(seconds * 1000)));
  }
  return DEFAULT_QUOTA_COOLDOWN_MS;
}

function cleanModelText(value: unknown): string {
  const text = typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map((part: any) => (typeof part === 'string' ? part : String(part?.text || ''))).join('')
      : '';
  // Reasoning models on free routes can leak their scratchpad into the reply.
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim();
}

async function requestCompatProvider(
  id: CompatId,
  prompt: string,
  systemPrompt: string,
  options: FreeChainOptions,
  fetchImpl: typeof fetch,
): Promise<string> {
  const spec = COMPAT[id];
  const apiKey = compatKey(id);
  const messages = [
    ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt.slice(-12_000) }] : []),
    { role: 'user', content: prompt.slice(-24_000) },
  ];
  const maxTokens = Math.max(32, Math.min(1200, Math.floor(Number(options.maxTokens) || 400)));
  const temperature = options.temperature !== undefined && Number.isFinite(Number(options.temperature))
    ? Math.max(0, Math.min(1, Number(options.temperature)))
    : 0.7;

  let last: { category: Category; cooldownMs: number } = { category: 'upstream', cooldownMs: TRANSIENT_COOLDOWN_MS };
  for (const model of compatModels(id)) {
    const remainingMs = typeof options.deadlineAtMs === 'number'
      ? Math.min(REQUEST_TIMEOUT_MS, options.deadlineAtMs - Date.now())
      : REQUEST_TIMEOUT_MS;
    if (remainingMs <= 0) {
      last = { category: 'upstream', cooldownMs: TRANSIENT_COOLDOWN_MS };
      break;
    }
    let response: Response;
    try {
      response = await fetchImpl(spec.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: false }),
        signal: AbortSignal.timeout(Math.max(1, remainingMs)),
        redirect: 'error',
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[Free AI Chain] request failed before an HTTP response', {
        provider: id, model, errorName: err.name, errorMessage: safeDetail(err.message),
      });
      // Network and timeout errors are not proof the model is bad; don't fan out across models.
      throw new ProviderFailure('upstream', TRANSIENT_COOLDOWN_MS);
    }

    if (response.ok) {
      const data: any = await response.json().catch(() => ({}));
      const text = cleanModelText(data?.choices?.[0]?.message?.content);
      if (text) return text;
      console.warn('[Free AI Chain] empty completion', { provider: id, model, finishReason: data?.choices?.[0]?.finish_reason });
      last = { category: 'empty_response', cooldownMs: TRANSIENT_COOLDOWN_MS };
      continue;
    }

    const status = response.status;
    const body = safeDetail(await response.text().catch(() => ''));
    console.warn('[Free AI Chain] provider rejected request', { provider: id, model, status, responseBody: body });

    if (status === 401 || status === 403) throw new ProviderFailure('authentication', AUTH_COOLDOWN_MS);
    if (status === 429) {
      last = { category: 'quota', cooldownMs: parseRetryAfterMs(response) };
      continue;
    }
    if (status === 404) {
      last = { category: 'upstream', cooldownMs: MODEL_MISSING_COOLDOWN_MS };
      continue;
    }
    if (status === 408 || status >= 500) {
      last = { category: 'upstream', cooldownMs: TRANSIENT_COOLDOWN_MS };
      continue;
    }
    // 400/413/422 and similar describe this request, not the provider. Move on without a cooldown.
    throw new ProviderFailure('upstream', 0, body);
  }
  throw new ProviderFailure(last.category, last.cooldownMs);
}

function isTransientLocalFailure(message: string): boolean {
  return /aborted|aborterror|timeout|timed out|fetch failed|econnrefused|econnreset|socket|502|503|504/i.test(message);
}

async function callProvider(
  id: FreeProviderId,
  prompt: string,
  systemPrompt: string,
  tenantId: string | undefined,
  options: FreeChainOptions,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (id === 'gemini') {
    // The Gemini module keeps its own cooldown and concurrency slot.
    return generateFreeGeminiResponse(prompt, systemPrompt, tenantId, options, fetchImpl);
  }
  if (id === 'local') {
    try {
      return (await requestSpmtLocalLlm(prompt, systemPrompt, options, fetchImpl)).text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderFailure('upstream', isTransientLocalFailure(message) ? LOCAL_TRANSIENT_COOLDOWN_MS : TRANSIENT_COOLDOWN_MS, safeDetail(message));
    }
  }
  return requestCompatProvider(id, prompt, systemPrompt, options, fetchImpl);
}

export async function generateFreeChainResponse(
  prompt: string,
  systemPrompt = '',
  tenantId?: string,
  options: FreeChainOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const failures: string[] = [];
  let anyConfigured = false;
  let lastCategory: Category = 'not_configured';
  const deadlineAtMs = typeof options.deadlineAtMs === 'number'
    ? options.deadlineAtMs
    : Date.now() + MAX_CHAIN_DURATION_MS;
  const boundedOptions: FreeChainOptions = { ...options, deadlineAtMs };

  for (const id of resolveChain(options.providers)) {
    if (Date.now() >= deadlineAtMs) {
      failures.push('chain: time budget exhausted');
      lastCategory = 'upstream';
      break;
    }
    if (!isProviderConfigured(id, tenantId)) continue;
    anyConfigured = true;

    const cooldown = cooldowns.get(id);
    if (cooldown && cooldown.until > Date.now()) {
      failures.push(`${id}: cooling down (${cooldown.category})`);
      lastCategory = cooldown.category;
      continue;
    }
    cooldowns.delete(id);

    try {
      const text = await callProvider(id, prompt, systemPrompt, tenantId, boundedOptions, fetchImpl);
      if (failures.length) {
        console.info(`[Free AI Chain] ${id} served tenant ${tenantId || 'global'} after: ${failures.join('; ')}`);
      }
      const limit = Math.max(1, Math.min(12_000, Math.floor(Number(options.maxCharacters) || 12_000)));
      return capAtCompleteSentence(text, limit);
    } catch (error) {
      // A moderation block is about this prompt. Do not shop it around to other providers.
      if (error instanceof FreeChatUnavailableError && error.category === 'blocked') throw error;

      let category: Category = 'upstream';
      if (error instanceof FreeChatUnavailableError) {
        category = error.category;
      } else if (error instanceof ProviderFailure) {
        category = error.category;
        if (error.cooldownMs > 0) cooldowns.set(id, { until: Date.now() + error.cooldownMs, category });
      } else {
        console.error('[Free AI Chain] unexpected provider error', { provider: id, message: safeDetail(error instanceof Error ? error.message : String(error)) });
      }
      failures.push(`${id}: ${category}`);
      lastCategory = category;
    }
  }

  console.error('[Free AI Chain] no free provider could answer', { tenant: tenantId || 'global', failures });
  throw new FreeChatUnavailableError(anyConfigured ? lastCategory : 'not_configured');
}
