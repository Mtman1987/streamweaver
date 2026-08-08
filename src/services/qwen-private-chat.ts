import type { PrivateChatMessage } from '@/lib/private-chat-store';
import {
  SPMT_PRIVATE_QWEN_BASE_URL,
  SPMT_PRIVATE_QWEN_MODEL,
} from '@/lib/private-chat-settings-store';

export { SPMT_PRIVATE_QWEN_BASE_URL, SPMT_PRIVATE_QWEN_MODEL };

const QWEN_TIMEOUT_MS = 90_000;
const QWEN_MAX_TOKENS = 900;
const QWEN_REPETITION_PENALTY = 1.12;
const QWEN_HISTORY_MESSAGE_LIMIT = 24;
const QWEN_HISTORY_CHARACTER_BUDGET = 28_000;
const QWEN_HISTORY_ENTRY_CHARACTER_LIMIT = 6_000;
const QWEN_RECENT_ASSISTANT_ECHO_LIMIT = 6;
const QWEN_RAW_REPLY_CHARACTER_LIMIT = 80_000;
const QWEN_ECHO_STRIP_LIMIT = 64;

export const QWEN_MAX_REPLY_CHARACTERS = 3_400;

export const QWEN_PRIVATE_ROLEPLAY_POLICY = [
  'This is a private fictional roleplay mode for consenting adults.',
  'Every participant and character must be unambiguously age 18 or older.',
  'Do not involve minors, age ambiguity, coercion, exploitation, incest, or sexualized real people.',
  'Respect consent, limits, safe words, and any request to stop or change direction.',
  'Stay in the configured character and preserve continuity from the supplied private history.',
  'Return only the assistant character next turn.',
  'Start with new continuation text. Never prepend, restate, summarize, or replay a previous assistant turn unless the user explicitly asks.',
  'Use non-thinking mode. Do not output private reasoning or <think> blocks.',
  'Do not reproduce the transcript, quote the latest user message, invent User or Assistant labels, or continue both sides of the conversation.',
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
};

export type QwenPrivateChatRequest = {
  /** Optional test/compatibility override. Production DMs use the built-in SPMT worker. */
  baseUrl?: string;
  /** Optional test/compatibility override. Production DMs use spmt-qwen3-4b. */
  model?: string;
  /** Retained for call-site compatibility; the private Fly worker does not use a bearer key. */
  apiKey?: string;
  systemPrompt: string;
  username: string;
  botName: string;
  message: string;
  history: PrivateChatMessage[];
  memoryIndex?: string[];
  memoryContext?: string;
  fetchImpl?: typeof fetch;
  runtime?: {
    production?: boolean;
    allowInsecureHttp?: boolean;
  };
};

export type QwenEndpointResult =
  | { ok: true; endpoint: string }
  | { ok: false; error: string };

type TokenSpan = {
  value: string;
  end: number;
};

function isPrivateQwenHost(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return (
    value === 'localhost' ||
    value === '127.0.0.1' ||
    value === '::1' ||
    value.endsWith('.internal') ||
    value.endsWith('.flycast') ||
    value.startsWith('fdaa:')
  );
}

export function resolveQwenEndpoint(
  rawBaseUrl = SPMT_PRIVATE_QWEN_BASE_URL,
  runtime: QwenPrivateChatRequest['runtime'] = {},
): QwenEndpointResult {
  const configured = String(rawBaseUrl || SPMT_PRIVATE_QWEN_BASE_URL).trim();

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return { ok: false, error: 'The built-in SPMT Qwen endpoint URL is invalid.' };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, error: 'The SPMT Qwen endpoint must use HTTP or HTTPS.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Qwen credentials must not be embedded in the endpoint URL.' };
  }

  const production = runtime.production ?? process.env.NODE_ENV === 'production';
  const allowInsecureHttp = runtime.allowInsecureHttp === true;
  if (production && url.protocol === 'http:' && !isPrivateQwenHost(url.hostname) && !allowInsecureHttp) {
    return {
      ok: false,
      error: 'Production Qwen HTTP traffic must stay on the Fly private network.',
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

function comparisonTokenSpans(value: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  for (const match of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    const index = match.index ?? 0;
    spans.push({
      value: match[0].toLocaleLowerCase(),
      end: index + match[0].length,
    });
  }
  return spans;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeLeadingAssistantLabel(value: string, botName: string): string {
  const labels = ['assistant', botName]
    .map((label) => label.trim())
    .filter(Boolean)
    .map(escapeRegExp);
  if (labels.length === 0) return value;
  return value.replace(new RegExp(`^\\s*(?:${labels.join('|')})\\s*:\\s*`, 'i'), '').trimStart();
}

function trimEchoSeparator(value: string, botName: string): string {
  const withoutSeparator = value
    .replace(/^[\s"'`*_~\-—–:>|,.;!?()[\]{}]+/u, '')
    .trimStart();
  return removeLeadingAssistantLabel(withoutSeparator, botName);
}

function stripLeadingKnownEcho(
  value: string,
  rawEcho: string,
  botName: string,
): { text: string; stripped: boolean } {
  const echo = removeLeadingAssistantLabel(stripQwenControlTokens(rawEcho), botName).trim();
  const echoKey = normalizeForComparison(echo);
  if (echoKey.length < 20) return { text: value, stripped: false };

  const source = value.trimStart();
  if (source.toLocaleLowerCase().startsWith(echo.toLocaleLowerCase())) {
    return {
      text: trimEchoSeparator(source.slice(echo.length), botName),
      stripped: true,
    };
  }

  if (echoKey.length < 48) return { text: value, stripped: false };

  const echoTokens = comparisonTokenSpans(echo);
  const sourceTokens = comparisonTokenSpans(source);
  if (echoTokens.length < 8 || sourceTokens.length < echoTokens.length) {
    return { text: value, stripped: false };
  }

  for (let index = 0; index < echoTokens.length; index++) {
    if (echoTokens[index].value !== sourceTokens[index].value) {
      return { text: value, stripped: false };
    }
  }

  return {
    text: trimEchoSeparator(source.slice(sourceTokens[echoTokens.length - 1].end), botName),
    stripped: true,
  };
}

function stripLeadingAssistantEchoes(
  value: string,
  rawCandidates: string[],
  botName: string,
): { text: string; strippedCount: number } {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const rawCandidate of rawCandidates.slice(-QWEN_RECENT_ASSISTANT_ECHO_LIMIT)) {
    const candidate = removeLeadingAssistantLabel(stripQwenControlTokens(rawCandidate), botName).trim();
    const key = normalizeForComparison(candidate);
    if (key.length < 20 || seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }

  let text = value;
  let strippedCount = 0;
  for (let pass = 0; pass < QWEN_ECHO_STRIP_LIMIT; pass++) {
    let strippedThisPass = false;
    for (let index = candidates.length - 1; index >= 0; index--) {
      const result = stripLeadingKnownEcho(text, candidates[index], botName);
      if (!result.stripped) continue;
      text = result.text;
      strippedCount++;
      strippedThisPass = true;
      break;
    }
    if (!strippedThisPass) break;
  }

  return { text, strippedCount };
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

function removeLeadingUserEcho(value: string, latestUserMessage: string): string {
  const echo = stripQwenControlTokens(latestUserMessage);
  if (normalizeForComparison(echo).length < 48) return value;
  const result = stripLeadingKnownEcho(value, echo, '');
  return result.stripped ? result.text : value;
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
  recentAssistantMessages?: string[];
  maxCharacters?: number;
}): string {
  const username = input.username || '';
  const botName = input.botName || '';
  const maxCharacters = Math.max(200, input.maxCharacters || QWEN_MAX_REPLY_CHARACTERS);

  let text = stripQwenControlTokens(input.text);
  text = removeLeadingAssistantLabel(text, botName);
  text = removeLeadingUserEcho(text, input.latestUserMessage || '');
  text = stripLeadingAssistantEchoes(text, input.recentAssistantMessages || [], botName).text;
  text = text.slice(0, QWEN_RAW_REPLY_CHARACTER_LIMIT);
  text = cutGeneratedTranscript(text, username);
  text = collapseRepeatedText(text);
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return truncateAtNaturalBoundary(text, maxCharacters);
}

function prepareHistoryEntry(
  entry: PrivateChatMessage,
  username: string,
  botName: string,
  recentAssistantMessages: string[],
): QwenChatMessage | null {
  const raw = String(entry.message || '').trim();
  if (!raw) return null;

  const content = entry.type === 'ai'
    ? sanitizeQwenReply({
        text: raw,
        username,
        botName,
        recentAssistantMessages,
        maxCharacters: QWEN_HISTORY_ENTRY_CHARACTER_LIMIT,
      })
    : truncateAtNaturalBoundary(stripQwenControlTokens(raw), QWEN_HISTORY_ENTRY_CHARACTER_LIMIT);
  if (!content) return null;
  return {
    role: entry.type === 'ai' ? 'assistant' : 'user',
    content,
  };
}

function collapseRepeatedMessageBlocks(entries: QwenChatMessage[], maxBlockSize = 6): QwenChatMessage[] {
  const output: QwenChatMessage[] = [];

  for (const entry of entries) {
    output.push(entry);
    let changed = true;
    while (changed) {
      changed = false;
      const largest = Math.min(maxBlockSize, Math.floor(output.length / 2));
      for (let blockSize = largest; blockSize >= 1; blockSize--) {
        const previous = output.slice(output.length - blockSize * 2, output.length - blockSize);
        const latest = output.slice(output.length - blockSize);
        const previousKey = previous
          .map((item) => `${item.role}:${normalizeForComparison(item.content)}`)
          .join('|');
        const latestKey = latest
          .map((item) => `${item.role}:${normalizeForComparison(item.content)}`)
          .join('|');
        if (previousKey.length >= 24 && previousKey === latestKey) {
          output.splice(output.length - blockSize, blockSize);
          changed = true;
          break;
        }
      }
    }
  }

  return output;
}

export function buildQwenMessages(input: {
  systemPrompt: string;
  username: string;
  botName: string;
  message: string;
  history: PrivateChatMessage[];
  memoryIndex?: string[];
  memoryContext?: string;
}): QwenChatMessage[] {
  const systemParts = [input.systemPrompt, QWEN_PRIVATE_ROLEPLAY_POLICY];
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

  const historyEntries: QwenChatMessage[] = [];
  const recentAssistantMessages: string[] = [];
  for (const entry of input.history.slice(-QWEN_HISTORY_MESSAGE_LIMIT * 2)) {
    const prepared = prepareHistoryEntry(
      entry,
      input.username,
      input.botName,
      recentAssistantMessages.slice(-QWEN_RECENT_ASSISTANT_ECHO_LIMIT),
    );
    if (!prepared) continue;
    historyEntries.push(prepared);
    if (prepared.role === 'assistant') {
      recentAssistantMessages.push(prepared.content);
    }
  }

  const deduplicated: QwenChatMessage[] = [];
  for (const entry of historyEntries) {
    const previous = deduplicated[deduplicated.length - 1];
    if (
      previous &&
      previous.role === entry.role &&
      normalizeForComparison(previous.content) === normalizeForComparison(entry.content)
    ) {
      continue;
    }
    deduplicated.push(entry);
  }

  const deLooped = collapseRepeatedMessageBlocks(deduplicated);
  const latestMessage = stripQwenControlTokens(input.message);
  while (
    deLooped.length &&
    deLooped[deLooped.length - 1].role === 'user' &&
    normalizeForComparison(deLooped[deLooped.length - 1].content) === normalizeForComparison(latestMessage)
  ) {
    deLooped.pop();
  }

  const withinBudget: QwenChatMessage[] = [];
  let usedCharacters = 0;
  for (let index = deLooped.length - 1; index >= 0; index--) {
    const entry = deLooped[index];
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

function repetitionPenalty(attempt: number): number {
  return Number((QWEN_REPETITION_PENALTY + (attempt > 0 ? 0.03 : 0)).toFixed(2));
}

function withNoThinkDirective(messages: QwenChatMessage[]): QwenChatMessage[] {
  return messages.map((entry, index) => {
    if (index !== messages.length - 1 || entry.role !== 'user') return entry;
    return { ...entry, content: `${entry.content}\n\n/no_think` };
  });
}

function repairMessagesAfterEcho(messages: QwenChatMessage[]): QwenChatMessage[] {
  const system = messages[0];
  const latestUser = messages[messages.length - 1];
  const priorUserMessages = messages
    .slice(1, -1)
    .filter((entry) => entry.role === 'user')
    .slice(-4);

  return [
    {
      role: 'system',
      content: [
        system?.content || '',
        'The prior generation was discarded because it copied earlier assistant text. Produce exactly one new assistant turn. Do not restate any prior assistant wording.',
      ].filter(Boolean).join('\n\n'),
    },
    ...priorUserMessages,
    latestUser,
  ].filter((entry): entry is QwenChatMessage => Boolean(entry?.content));
}

function requestBody(messages: QwenChatMessage[], attempt: number, model: string) {
  const penalty = repetitionPenalty(attempt);
  return {
    model,
    messages: withNoThinkDirective(messages),
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    repeat_penalty: penalty,
    // Keep the OpenAI-style alias for compatibility while llama.cpp uses repeat_penalty.
    repetition_penalty: penalty,
    thinking_budget_tokens: 0,
    max_tokens: QWEN_MAX_TOKENS,
    stream: false,
    stop: ['<|im_end|>', '<|endoftext|>', '\nUser:', '\nHuman:'],
  };
}

export async function requestQwenPrivateChatCompletion(
  input: QwenPrivateChatRequest,
): Promise<QwenPrivateChatCompletion> {
  const provider: QwenPrivateChatCompletion['provider'] = 'self-hosted-qwen';
  const target = resolveQwenEndpoint(input.baseUrl || SPMT_PRIVATE_QWEN_BASE_URL, input.runtime);
  if (!target.ok) return { text: '', provider, upstreamError: target.error };
  const model = input.model?.trim() || SPMT_PRIVATE_QWEN_MODEL;

  const baseMessages = buildQwenMessages(input);
  const recentAssistantMessages = baseMessages
    .filter((entry) => entry.role === 'assistant')
    .map((entry) => entry.content)
    .slice(-QWEN_RECENT_ASSISTANT_ECHO_LIMIT);
  // The worker is reachable only through Fly private networking. Do not send a model API key.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const fetchImpl = input.fetchImpl || fetch;

  let lastFinishReason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = attempt === 0 ? baseMessages : repairMessagesAfterEcho(baseMessages);
    const body = requestBody(messages, attempt, model);

    try {
      const response = await fetchImpl(target.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
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

      lastFinishReason = String(payload?.choices?.[0]?.finish_reason || '');
      const rawText = extractQwenText(payload);
      const text = sanitizeQwenReply({
        text: rawText,
        username: input.username,
        botName: input.botName,
        latestUserMessage: input.message,
        recentAssistantMessages,
      });
      if (text) {
        return { text, provider, finishReason: lastFinishReason || undefined };
      }

      if (attempt === 0 && rawText.trim()) {
        continue;
      }

      return {
        text: '',
        provider,
        upstreamStatus: response.status,
        upstreamError: rawText.trim()
          ? 'The Qwen model repeated prior assistant text and produced no new usable reply.'
          : 'The Qwen model returned no usable text.',
        finishReason: lastFinishReason || undefined,
      };
    } catch (error) {
      return {
        text: '',
        provider,
        upstreamError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    text: '',
    provider,
    upstreamError: 'The Qwen model returned no usable text after an anti-repetition retry.',
    finishReason: lastFinishReason || undefined,
  };
}
