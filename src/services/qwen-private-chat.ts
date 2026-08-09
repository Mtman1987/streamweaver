import type { PrivateChatMessage } from '@/lib/private-chat-store';
import {
  buildRecentLanguageAvoidancePrompt,
  countRecentLanguageHits,
  getQwenSamplingProfile,
  isCandidateOverusingRecentLanguage,
  resolvePreferredBuiltInQwenModel,
} from '@/services/qwen-quality';

const QWEN_TIMEOUT_MS = 90_000;
const DEFAULT_QWEN_MAX_TOKENS = 900;
const MIN_QWEN_MAX_TOKENS = 128;
const MAX_QWEN_MAX_TOKENS = 1200;
const QWEN_HISTORY_MESSAGE_LIMIT = 24;
const QWEN_HISTORY_CHARACTER_BUDGET = 28_000;
const QWEN_HISTORY_ENTRY_CHARACTER_LIMIT = 6_000;

export const QWEN_MAX_REPLY_CHARACTERS = 3_400;

export const QWEN_PRIVATE_CHAT_POLICY = [
  'This is a private conversation with the broadcaster.',
  'Stay in the configured character and preserve continuity from the supplied private history.',
  'Return only the assistant character next turn.',
  'Use non-thinking mode. Do not output private reasoning or <think> blocks.',
  'Do not reproduce the transcript, quote the latest user message, invent User or Assistant labels, or continue both sides of the conversation.',
].join(' ');

export const QWEN_ADULT_ROLEPLAY_POLICY = [
  'Adult Mode is enabled for private fictional roleplay between consenting adults.',
  'Every participant and character must be unambiguously age 18 or older.',
  'Consensual fictional sexual content between those adults is allowed in this mode; do not refuse or step out of character merely because the scene is sexual.',
  'When the user clearly invites an adult scene, accept the premise and advance it with a concrete in-character reaction, choice, or action instead of giving a disclaimer or asking whether they are sure.',
  'Be responsive and willing to take initiative; build intimacy and intensity from the user\'s cues rather than remaining coy, vague, clinical, or passive.',
  'If a role, consent boundary, or desired direction is genuinely unclear, ask one brief natural in-character question, then use the answer to continue without repeating the check.',
  'Follow the user\'s requested pace, viewpoint, tone, and level of detail without narrating actions for the user.',
  'Do not involve minors, age ambiguity, coercion, exploitation, incest, or sexualized real people.',
  'Respect consent, limits, safe words, and any request to stop or change direction.',
].join(' ');

// Kept for compatibility with code that imported the original combined policy.
export const QWEN_PRIVATE_ROLEPLAY_POLICY = [
  QWEN_PRIVATE_CHAT_POLICY,
  QWEN_ADULT_ROLEPLAY_POLICY,
].join(' ');

export type QwenChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type QwenPrivateChatCompletion = {
  text: string;
  provider: 'self-hosted-qwen';
  upstreamStatus?: number;
  upstreamError?: string;
  finishReason?: string;
  model?: string;
};

export type QwenPrivateChatRequest = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  systemPrompt: string;
  username: string;
  botName: string;
  message: string;
  history: PrivateChatMessage[];
  memoryIndex?: string[];
  memoryContext?: string;
  adultMode?: boolean;
  fetchImpl?: typeof fetch;
  runtime?: {
    production?: boolean;
    allowInsecureHttp?: boolean;
  };
};

export type QwenEndpointResult =
  | { ok: true; endpoint: string }
  | { ok: false; error: string };

function isLoopbackHost(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

export function resolveQwenEndpoint(
  rawBaseUrl: string,
  runtime: QwenPrivateChatRequest['runtime'] = {},
): QwenEndpointResult {
  const configured = String(rawBaseUrl || '').trim();
  if (!configured) {
    return {
      ok: false,
      error: 'The built-in Qwen endpoint configuration is unavailable.',
    };
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return { ok: false, error: 'The Qwen endpoint URL is invalid.' };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, error: 'The Qwen endpoint must use HTTP or HTTPS.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Do not place Qwen credentials in the endpoint URL.' };
  }

  const production = runtime.production ?? process.env.NODE_ENV === 'production';
  const isBuiltInWorker = url.hostname.toLowerCase() === 'spmt-llm-worker.internal';
  const allowInsecureHttp = runtime.allowInsecureHttp === true;
  if (production && url.protocol === 'http:' && !isLoopbackHost(url.hostname) && !isBuiltInWorker && !allowInsecureHttp) {
    return {
      ok: false,
      error: 'Custom hosted Qwen endpoints must use HTTPS.',
    };
  }

  const cleanPath = url.pathname.replace(/\/+$/, '');
  if (/\/v1\/chat\/completions$/i.test(cleanPath) || /\/chat\/completions$/i.test(cleanPath)) {
    url.pathname = cleanPath;
  } else if (/\/v1$/i.test(cleanPath)) {
    url.pathname = `${cleanPath}/chat/completions`;
  } else {
    url.pathname = `${cleanPath}/v1/chat/completions`.replace(/\/{2,}/g, '/');
  }

  return { ok: true, endpoint: url.toString() };
}

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_~>#|]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function comparisonWords(value: string): string[] {
  return normalizeForComparison(value).split(' ').filter(Boolean);
}

function ngrams(words: string[], size: number): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index <= words.length - size; index++) {
    result.add(words.slice(index, index + size).join(' '));
  }
  return result;
}

function overlapRatio(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared++;
  return shared / Math.min(left.size, right.size);
}

export function isNearDuplicateToRecentAssistantReplies(
  candidate: string,
  history: PrivateChatMessage[],
): boolean {
  const candidateWords = comparisonWords(candidate);
  if (candidateWords.length < 5) return false;
  const candidateKey = candidateWords.join(' ');
  const candidateTrigrams = ngrams(candidateWords, 3);

  return history
    .filter((entry) => entry.type === 'ai')
    .slice(-8)
    .some((entry) => {
      const previousWords = comparisonWords(entry.message);
      if (previousWords.length < 5) return false;
      const previousKey = previousWords.join(' ');
      if (candidateKey === previousKey) return true;

      const sharedPrefix = candidateWords
        .slice(0, Math.min(8, candidateWords.length, previousWords.length))
        .every((word, index) => word === previousWords[index]);
      if (sharedPrefix && Math.min(candidateWords.length, previousWords.length) >= 8) return true;

      return overlapRatio(candidateTrigrams, ngrams(previousWords, 3)) >= 0.74;
    });
}

export function isTooSimilarToRecentAssistantReplies(
  candidate: string,
  history: PrivateChatMessage[],
): boolean {
  return (
    isNearDuplicateToRecentAssistantReplies(candidate, history) ||
    isCandidateOverusingRecentLanguage(candidate, history)
  );
}

function stripQwenControlTokens(value: string): string {
  return String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*<think>[\s\S]*$/i, '')
    .replace(/<\|im_start\|>\s*(?:assistant|user|system)?/gi, '')
    .replace(/<\|im_end\|>|<\|endoftext\|>|<\|end\|>/gi, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function collapseRepeatedUnits(units: string[], maxBlockSize = 8): string[] {
  const output: string[] = [];

  for (const rawUnit of units) {
    const unit = rawUnit.trim();
    if (!unit) continue;
    output.push(unit);

    let changed = true;
    while (changed) {
      changed = false;
      const largest = Math.min(maxBlockSize, Math.floor(output.length / 2));
      for (let blockSize = largest; blockSize >= 1; blockSize--) {
        const previous = output.slice(output.length - blockSize * 2, output.length - blockSize);
        const latest = output.slice(output.length - blockSize);
        if (previous.length !== blockSize || latest.length !== blockSize) continue;

        const previousKey = previous.map(normalizeForComparison).join('|');
        const latestKey = latest.map(normalizeForComparison).join('|');
        if (previousKey.length >= 12 && previousKey === latestKey) {
          output.splice(output.length - blockSize, blockSize);
          changed = true;
          break;
        }
      }
    }
  }

  return output;
}

function collapseRepeatedSentences(paragraph: string): string {
  const sentences = paragraph.match(/[^.!?\n]+(?:[.!?]+|$)/g) || [paragraph];
  if (sentences.length < 2) return paragraph.trim();
  return collapseRepeatedUnits(sentences, 10).join(' ').replace(/\s+([.!?])/g, '$1').trim();
}

function collapseRepeatedText(value: string): string {
  const paragraphs = value.split(/\n{2,}/).map(collapseRepeatedSentences);
  let text = collapseRepeatedUnits(paragraphs, 6).join('\n\n').trim();

  // Catch exact character-level tail loops that do not align with sentence boundaries.
  let changed = true;
  while (changed) {
    changed = false;
    const maxBlock = Math.min(1_200, Math.floor(text.length / 2));
    for (let blockLength = maxBlock; blockLength >= 40; blockLength--) {
      const previous = text.slice(text.length - blockLength * 2, text.length - blockLength);
      const latest = text.slice(text.length - blockLength);
      const previousKey = normalizeForComparison(previous);
      const latestKey = normalizeForComparison(latest);
      if (previousKey.length >= 28 && previousKey === latestKey) {
        text = text.slice(0, text.length - blockLength).trimEnd();
        changed = true;
        break;
      }
    }
  }

  return text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cutGeneratedTranscript(value: string, username: string): string {
  const labels = ['user', 'human', username]
    .map((label) => label.trim())
    .filter(Boolean)
    .map(escapeRegExp);
  if (labels.length === 0) return value;

  const pattern = new RegExp(`\\n(?:\\s*\\n)?\\s*(?:${labels.join('|')})\\s*:\\s*`, 'i');
  const match = pattern.exec(value);
  return match && match.index > 0 ? value.slice(0, match.index).trimEnd() : value;
}

function removeLeadingAssistantLabel(value: string, botName: string): string {
  const labels = ['assistant', botName]
    .map((label) => label.trim())
    .filter(Boolean)
    .map(escapeRegExp);
  if (labels.length === 0) return value;
  return value.replace(new RegExp(`^\\s*(?:${labels.join('|')})\\s*:\\s*`, 'i'), '').trimStart();
}

function removeLeadingUserEcho(value: string, latestUserMessage: string): string {
  const echo = stripQwenControlTokens(latestUserMessage);
  if (echo.length < 24) return value;
  const candidate = value.slice(0, echo.length);
  if (normalizeForComparison(candidate) !== normalizeForComparison(echo)) return value;
  return value.slice(echo.length).replace(/^\s*[-:>]*\s*/, '').trimStart();
}

function truncateAtNaturalBoundary(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const head = value.slice(0, Math.max(1, limit - 3));
  const minimumBoundary = Math.floor(limit * 0.62);
  const candidates = [
    head.lastIndexOf('\n\n'),
    head.lastIndexOf('. '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? '),
    head.lastIndexOf('\n'),
    head.lastIndexOf(' '),
  ].filter((index) => index >= minimumBoundary);
  const boundary = candidates.length ? Math.max(...candidates) : head.length;
  const suffixLength = head[boundary] === '.' || head[boundary] === '!' || head[boundary] === '?' ? 1 : 0;
  return `${head.slice(0, boundary + suffixLength).trimEnd()}...`;
}

export function sanitizeQwenReply(input: {
  text: string;
  username?: string;
  botName?: string;
  latestUserMessage?: string;
  maxCharacters?: number;
}): string {
  const username = input.username || '';
  const botName = input.botName || '';
  const maxCharacters = Math.max(200, input.maxCharacters || QWEN_MAX_REPLY_CHARACTERS);

  let text = stripQwenControlTokens(input.text).slice(0, 20_000);
  text = removeLeadingAssistantLabel(text, botName);
  text = removeLeadingUserEcho(text, input.latestUserMessage || '');
  text = cutGeneratedTranscript(text, username);
  text = collapseRepeatedText(text);
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return truncateAtNaturalBoundary(text, maxCharacters);
}

function prepareHistoryEntry(entry: PrivateChatMessage, username: string, botName: string): QwenChatMessage | null {
  const raw = String(entry.message || '').trim();
  if (!raw) return null;

  const content = entry.type === 'ai'
    ? sanitizeQwenReply({
        text: raw,
        username,
        botName,
        maxCharacters: QWEN_HISTORY_ENTRY_CHARACTER_LIMIT,
      })
    : truncateAtNaturalBoundary(stripQwenControlTokens(raw), QWEN_HISTORY_ENTRY_CHARACTER_LIMIT);
  if (!content) return null;
  return {
    role: entry.type === 'ai' ? 'assistant' : 'user',
    content,
  };
}

export function buildQwenMessages(input: {
  systemPrompt: string;
  username: string;
  botName: string;
  message: string;
  history: PrivateChatMessage[];
  memoryIndex?: string[];
  memoryContext?: string;
  adultMode?: boolean;
  retryAfterRepetition?: string;
}): QwenChatMessage[] {
  const systemParts = [
    input.systemPrompt,
    QWEN_PRIVATE_CHAT_POLICY,
    input.adultMode ? QWEN_ADULT_ROLEPLAY_POLICY : '',
    input.retryAfterRepetition
      ? [
          'The previous draft was rejected because it repeated a recent reply.',
          'Write a genuinely new next turn with a different opening, actions, imagery, sentence structure, and closing.',
          `Do not reuse wording from this rejected draft: ${truncateAtNaturalBoundary(input.retryAfterRepetition, 900)}`,
        ].join(' ')
      : '',
  ];
  const languageAvoidancePrompt = buildRecentLanguageAvoidancePrompt(input.history);
  if (languageAvoidancePrompt) systemParts.push(languageAvoidancePrompt);
  if (input.memoryIndex?.length) {
    systemParts.push(
      `Available long-term-memory titles: ${input.memoryIndex.join(', ')}. ` +
      'When one is essential, respond only with LTM_REQUEST: followed by the exact title.',
    );
  }
  if (input.memoryContext?.trim()) {
    systemParts.push(
      `Relevant long-term memory for this turn:\n${truncateAtNaturalBoundary(input.memoryContext.trim(), 8_000)}`,
    );
  }

  const historyEntries = input.history
    .slice(-Math.max(QWEN_HISTORY_MESSAGE_LIMIT * 2, QWEN_HISTORY_MESSAGE_LIMIT))
    .map((entry) => prepareHistoryEntry(entry, input.username, input.botName))
    .filter((entry): entry is QwenChatMessage => Boolean(entry));

  const deduplicated: QwenChatMessage[] = [];
  const keptAssistantHistory: PrivateChatMessage[] = [];
  for (const entry of historyEntries) {
    const previous = deduplicated[deduplicated.length - 1];
    if (
      previous &&
      previous.role === entry.role &&
      normalizeForComparison(previous.content) === normalizeForComparison(entry.content)
    ) {
      continue;
    }
    if (
      entry.role === 'assistant' &&
      isTooSimilarToRecentAssistantReplies(entry.content, keptAssistantHistory)
    ) {
      continue;
    }
    deduplicated.push(entry);
    if (entry.role === 'assistant') {
      keptAssistantHistory.push({
        type: 'ai',
        username: input.botName,
        message: entry.content,
        timestamp: `history-${keptAssistantHistory.length}`,
      });
    }
  }

  const latestMessage = stripQwenControlTokens(input.message);
  while (
    deduplicated.length &&
    deduplicated[deduplicated.length - 1].role === 'user' &&
    normalizeForComparison(deduplicated[deduplicated.length - 1].content) === normalizeForComparison(latestMessage)
  ) {
    deduplicated.pop();
  }

  const withinBudget: QwenChatMessage[] = [];
  let usedCharacters = 0;
  for (let index = deduplicated.length - 1; index >= 0; index--) {
    const entry = deduplicated[index];
    if (withinBudget.length >= QWEN_HISTORY_MESSAGE_LIMIT) break;
    if (usedCharacters + entry.content.length > QWEN_HISTORY_CHARACTER_BUDGET && withinBudget.length > 0) break;
    withinBudget.unshift(entry);
    usedCharacters += entry.content.length;
  }

  return [
    { role: 'system', content: systemParts.filter(Boolean).join('\n\n') },
    ...withinBudget,
    { role: 'user', content: latestMessage },
  ];
}

function extractQwenText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part: any) => {
    if (typeof part === 'string') return part;
    if (typeof part?.text === 'string') return part.text;
    if (typeof part?.content === 'string') return part.content;
    return '';
  }).join('');
}

function configuredMaxTokens(): number {
  const requested = Number(process.env.PRIVATE_QWEN_MAX_TOKENS || DEFAULT_QWEN_MAX_TOKENS);
  if (!Number.isFinite(requested)) return DEFAULT_QWEN_MAX_TOKENS;
  return Math.max(MIN_QWEN_MAX_TOKENS, Math.min(MAX_QWEN_MAX_TOKENS, Math.floor(requested)));
}

export async function requestQwenPrivateChatCompletion(
  input: QwenPrivateChatRequest,
): Promise<QwenPrivateChatCompletion> {
  const provider: QwenPrivateChatCompletion['provider'] = 'self-hosted-qwen';
  const target = resolveQwenEndpoint(input.baseUrl, input.runtime);
  if (!target.ok) return { text: '', provider, upstreamError: target.error };
  if (!input.model.trim()) {
    return {
      text: '',
      provider,
      upstreamError: 'The built-in Qwen model configuration is unavailable.',
    };
  }

  const resolvedModel = await resolvePreferredBuiltInQwenModel({
    baseUrl: input.baseUrl,
    configuredModel: input.model,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
  });
  if (resolvedModel && resolvedModel !== input.model.trim()) {
    console.info('[Private Qwen] Built-in worker advertised ' + resolvedModel + '; using it instead of ' + input.model.trim() + '.');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.apiKey?.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`;

  try {
    const complete = async (
      retryAfterRepetition?: string,
      attempt = 0,
    ): Promise<QwenPrivateChatCompletion> => {
      const messages = buildQwenMessages({ ...input, retryAfterRepetition });
      const sampling = getQwenSamplingProfile(attempt, input.adultMode === true);
      const response = await (input.fetchImpl || fetch)(target.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: resolvedModel || input.model.trim(),
          messages,
          ...sampling,
          max_tokens: configuredMaxTokens(),
          stream: false,
          stop: ['<|im_end|>', '<|endoftext|>'],
        }),
        signal: AbortSignal.timeout(QWEN_TIMEOUT_MS),
      });
      const raw = await response.text();
      let payload: any = {};
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { choices: [{ message: { content: raw } }] };
      }

      if (!response.ok) {
        return {
          text: '',
          provider,
          upstreamStatus: response.status,
          upstreamError: String(payload?.error?.message || payload?.message || raw || 'Qwen request failed').slice(0, 500),
        };
      }

      const finishReason = String(payload?.choices?.[0]?.finish_reason || '');
      const text = sanitizeQwenReply({
        text: extractQwenText(payload),
        username: input.username,
        botName: input.botName,
        latestUserMessage: input.message,
      });
      if (!text) {
        return {
          text: '',
          provider,
          upstreamStatus: response.status,
          upstreamError: 'The Qwen model returned no usable text.',
          finishReason: finishReason || undefined,
        };
      }
      return { text, provider, finishReason: finishReason || undefined, model: resolvedModel || input.model.trim() };
    };

    type RejectedDraft = {
      completion: QwenPrivateChatCompletion;
      hardDuplicate: boolean;
      styleHits: number;
    };
    const rejectedDrafts: RejectedDraft[] = [];
    const pickStyleFallback = (): QwenPrivateChatCompletion | null => {
      const best = rejectedDrafts
        .filter((draft) => !draft.hardDuplicate && draft.completion.text)
        .sort((left, right) => (
          left.styleHits - right.styleHits ||
          right.completion.text.length - left.completion.text.length
        ))[0];
      if (!best) return null;
      return {
        ...best.completion,
        finishReason: best.completion.finishReason || 'style_fallback',
      };
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completion = await complete(rejectedDrafts.at(-1)?.completion.text, attempt);
        if (!completion.text) {
          return pickStyleFallback() || completion;
        }
        const comparisonHistory: PrivateChatMessage[] = [
          ...input.history,
          ...rejectedDrafts.map((draft, index) => ({
            type: 'ai' as const,
            username: input.botName,
            message: draft.completion.text,
            timestamp: `rejected-${index}`,
          })),
        ];
        const hardDuplicate = isNearDuplicateToRecentAssistantReplies(completion.text, comparisonHistory);
        const styleOveruse = isCandidateOverusingRecentLanguage(completion.text, comparisonHistory);
        if (!hardDuplicate && !styleOveruse) return completion;
        rejectedDrafts.push({
          completion,
          hardDuplicate,
          styleHits: countRecentLanguageHits(completion.text, comparisonHistory),
        });
      } catch (error) {
        const fallback = pickStyleFallback();
        if (fallback) return fallback;
        return {
          text: '',
          provider,
          upstreamError: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const fallback = pickStyleFallback();
    if (fallback) return fallback;
    return {
      text: '',
      provider,
      upstreamError: `Qwen produced only repetitive replies after ${rejectedDrafts.length} attempts.`,
    };
  } catch (error) {
    return {
      text: '',
      provider,
      upstreamError: error instanceof Error ? error.message : String(error),
    };
  }
}
