import type { PrivateChatMessage } from '@/lib/private-chat-store';

const BUILT_IN_QWEN_HOST = 'spmt-llm-worker.internal';
export const DEFAULT_BUILT_IN_QWEN_MODEL = 'spmt-qwen3-4b';
const MODEL_DISCOVERY_TIMEOUT_MS = 5_000;
const MODEL_DISCOVERY_CACHE_MS = 5 * 60_000;

const STYLE_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'your', 'you', 'are', 'for', 'but', 'not',
  'into', 'just', 'like', 'then', 'than', 'have', 'has', 'had', 'was', 'were', 'will', 'would',
  'can', 'could', 'should', 'its', 'our', 'out', 'all', 'too', 'very', 'more', 'some', 'what',
  'when', 'where', 'who', 'how', 'why', 'let', 'lets', 'im', 'ive', 'ill', 'a', 'an', 'to', 'of',
  'in', 'on', 'at', 'is', 'it', 'as', 'my', 'me', 'we', 'i', 'be', 'or', 'if', 'so', 'do',
]);

type ModelCacheEntry = { expiresAt: number; models: string[] };
const modelCache = new Map<string, ModelCacheEntry>();

export type QwenSamplingProfile = {
  temperature: number;
  top_p: number;
  top_k: number;
  repetition_penalty: number;
  presence_penalty: number;
  frequency_penalty: number;
};

export type RecurringAssistantLanguage = {
  phrases: string[];
  terms: string[];
};

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_~>#|]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value: string): string[] {
  return normalize(value).split(' ').filter(Boolean);
}

export function getQwenSamplingProfile(attempt: number, adultMode = false): QwenSamplingProfile {
  const retry = Math.max(0, Math.min(2, Math.floor(attempt)));
  if (adultMode) {
    if (retry === 0) {
      return {
        temperature: 0.72,
        top_p: 0.90,
        top_k: 40,
        repetition_penalty: 1.08,
        presence_penalty: 0.15,
        frequency_penalty: 0.18,
      };
    }
    if (retry === 1) {
      return {
        temperature: 0.78,
        top_p: 0.92,
        top_k: 50,
        repetition_penalty: 1.11,
        presence_penalty: 0.22,
        frequency_penalty: 0.26,
      };
    }
    return {
      temperature: 0.82,
      top_p: 0.94,
      top_k: 60,
      repetition_penalty: 1.13,
      presence_penalty: 0.28,
      frequency_penalty: 0.30,
    };
  }

  if (retry === 0) {
    return {
      temperature: 0.68,
      top_p: 0.88,
      top_k: 35,
      repetition_penalty: 1.08,
      presence_penalty: 0.12,
      frequency_penalty: 0.16,
    };
  }
  if (retry === 1) {
    return {
      temperature: 0.74,
      top_p: 0.90,
      top_k: 45,
      repetition_penalty: 1.10,
      presence_penalty: 0.18,
      frequency_penalty: 0.22,
    };
  }
  return {
    temperature: 0.78,
    top_p: 0.92,
    top_k: 50,
    repetition_penalty: 1.12,
    presence_penalty: 0.22,
    frequency_penalty: 0.26,
  };
}

export function extractRecurringAssistantLanguage(
  history: PrivateChatMessage[],
  limit = 14,
): RecurringAssistantLanguage {
  const replies = history.filter((entry) => entry.type === 'ai').slice(-10);
  if (replies.length < 2) return { phrases: [], terms: [] };

  const phraseCounts = new Map<string, number>();
  const termCounts = new Map<string, number>();

  for (const reply of replies) {
    const replyWords = words(reply.message);
    const seenPhrases = new Set<string>();
    const seenTerms = new Set<string>();

    for (const word of replyWords) {
      if (word.length >= 4 && !STYLE_STOPWORDS.has(word)) seenTerms.add(word);
    }

    for (let size = 5; size >= 2; size--) {
      for (let index = 0; index <= replyWords.length - size; index++) {
        const slice = replyWords.slice(index, index + size);
        const meaningfulCount = slice.filter((word) => word.length >= 4 && !STYLE_STOPWORDS.has(word)).length;
        if (meaningfulCount < Math.min(2, size)) continue;
        const phrase = slice.join(' ');
        if (phrase.length >= 10) seenPhrases.add(phrase);
      }
    }

    for (const phrase of seenPhrases) phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
    for (const term of seenTerms) termCounts.set(term, (termCounts.get(term) || 0) + 1);
  }

  const phrases = [...phraseCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || right[0].split(' ').length - left[0].split(' ').length)
    .map(([phrase]) => phrase)
    .filter((phrase, index, all) => !all.slice(0, index).some((kept) => kept.includes(phrase)))
    .slice(0, limit);

  const repeatedTermThreshold = Math.min(4, replies.length);
  const terms = [...termCounts.entries()]
    .filter(([, count]) => count >= repeatedTermThreshold)
    .sort((left, right) => right[1] - left[1])
    .map(([term]) => term)
    .slice(0, 8);

  return { phrases, terms };
}

export function buildRecentLanguageAvoidancePrompt(history: PrivateChatMessage[]): string {
  const recurring = extractRecurringAssistantLanguage(history);
  if (!recurring.phrases.length && !recurring.terms.length) return '';

  const avoid = [
    ...recurring.phrases.map((phrase) => `phrase: "${phrase}"`),
    ...recurring.terms.map((term) => `term: "${term}"`),
  ].slice(0, 18);

  return [
    'VARIETY GUARD: Recent assistant turns have overused the language below.',
    'Avoid these phrases, pet-name habits, stage-direction openings, and signature metaphors when a natural alternative exists.',
    'Do not sacrifice a correct, direct answer merely to avoid one familiar word or phrase.',
    'Prefer plain, specific language tied to the newest turn rather than swapping in another generic cosmic metaphor.',
    avoid.join('; '),
  ].join(' ');
}

export function countRecentLanguageHits(candidate: string, history: PrivateChatMessage[]): number {
  const recurring = extractRecurringAssistantLanguage(history);
  if (!recurring.phrases.length) return 0;
  const padded = ` ${normalize(candidate)} `;
  return recurring.phrases.filter((phrase) => padded.includes(` ${phrase} `)).length;
}

export function isCandidateOverusingRecentLanguage(candidate: string, history: PrivateChatMessage[]): boolean {
  const recurring = extractRecurringAssistantLanguage(history);
  if (!recurring.phrases.length) return false;
  const padded = ` ${normalize(candidate)} `;
  const phraseHits = recurring.phrases.filter((phrase) => padded.includes(` ${phrase} `));

  // Style overlap should encourage a retry, not make ordinary answers impossible.
  // Require multiple recurring phrases before classifying a draft as overusing style.
  if (phraseHits.length >= 3) return true;
  return phraseHits.length >= 2 && phraseHits.some((phrase) => phrase.split(' ').length >= 4);
}

function modelRank(model: string): number {
  const normalized = model.toLowerCase();
  if (/qwen[^\n]*14b/.test(normalized)) return 3;
  if (/qwen[^\n]*8b/.test(normalized)) return 2;
  if (/qwen[^\n]*4b/.test(normalized)) return 1;
  return 0;
}

export function selectPreferredBuiltInQwenModel(configuredModel: string, availableModels: string[]): string {
  const configured = String(configuredModel || '').trim();
  if (!configured || configured.toLowerCase() !== DEFAULT_BUILT_IN_QWEN_MODEL) return configured;

  const candidates = availableModels
    .map((model) => String(model || '').trim())
    .filter(Boolean)
    .filter((model) => modelRank(model) > 0)
    .sort((left, right) => modelRank(right) - modelRank(left));

  return candidates[0] || configured;
}

function buildModelsEndpoint(baseUrl: string): { key: string; url: string } | null {
  try {
    const url = new URL(baseUrl);
    if (url.hostname.toLowerCase() !== BUILT_IN_QWEN_HOST) return null;
    const cleanPath = url.pathname.replace(/\/+$/, '');
    if (/\/v1\/chat\/completions$/i.test(cleanPath)) {
      url.pathname = cleanPath.replace(/\/chat\/completions$/i, '/models');
    } else if (/\/v1$/i.test(cleanPath)) {
      url.pathname = `${cleanPath}/models`;
    } else {
      url.pathname = `${cleanPath}/v1/models`.replace(/\/{2,}/g, '/');
    }
    return {
      key: `${url.origin}${url.pathname}`,
      url: url.toString(),
    };
  } catch {
    return null;
  }
}

export function clearQwenModelCapabilityCacheForTests(): void {
  modelCache.clear();
}

export async function discoverAvailableBuiltInQwenModels(input: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const endpoint = buildModelsEndpoint(input.baseUrl);
  if (!endpoint) return [];

  const cached = modelCache.get(endpoint.key);
  if (cached && cached.expiresAt > Date.now()) return [...cached.models];

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (input.apiKey?.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`;

  try {
    const response = await (input.fetchImpl || fetch)(endpoint.url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null) as any;
    const models = Array.isArray(payload?.data)
      ? payload.data.map((entry: any) => String(entry?.id || '').trim()).filter(Boolean)
      : [];
    const uniqueModels = [...new Set<string>(models)];
    modelCache.set(endpoint.key, {
      expiresAt: Date.now() + MODEL_DISCOVERY_CACHE_MS,
      models: uniqueModels,
    });
    return [...uniqueModels];
  } catch {
    return [];
  }
}

export async function resolvePreferredBuiltInQwenModel(input: {
  baseUrl: string;
  configuredModel: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const configured = String(input.configuredModel || '').trim();
  if (!configured || configured.toLowerCase() !== DEFAULT_BUILT_IN_QWEN_MODEL) return configured;

  const models = await discoverAvailableBuiltInQwenModels({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
  });
  return selectPreferredBuiltInQwenModel(configured, models);
}
