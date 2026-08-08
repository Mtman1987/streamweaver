import type { PrivateChatMessage } from '@/lib/private-chat-store';

const QWEN_TIMEOUT_MS = 90_000;
const DEFAULT_QWEN_MAX_TOKENS = 900;
const MIN_QWEN_MAX_TOKENS = 128;
const MAX_QWEN_MAX_TOKENS = 1200;
const QWEN_HISTORY_MESSAGE_LIMIT = 24;
const QWEN_HISTORY_CHARACTER_BUDGET = 28_000;
const QWEN_HISTORY_ENTRY_CHARACTER_LIMIT = 6_000;

export const QWEN_MAX_REPLY_CHARACTERS = 3_400;

export const QWEN_PRIVATE_ROLEPLAY_POLICY = [
  'This is a private fictional roleplay mode for consenting adults.',
  'Every participant and character must be unambiguously age 18 or older.',
  'Do not involve minors, age ambiguity, coercion, exploitation, incest, or sexualized real people.',
  'Respect consent, limits, safe words, and any request to stop or change direction.',
  'Stay in the configured character and preserve continuity from the supplied private history.',
  'Return only the assistant character next turn.',
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
      error: 'No Qwen endpoint is configured. Set PRIVATE_QWEN_BASE_URL or configure it on the Private Chat page.',
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
    return { ok: false, error: 'Do not place Qwen credentials in the endpoint URL. Use PRIVATE_QWEN_API_KEY.' };
  }

  const production = runtime.production ?? process.env.NODE_ENV === 'production';
  const allowInsecureHttp = runtime.allowInsecureHttp ?? process.env.PRIVATE_QWEN_ALLOW_HTTP === 'true';
  if (production && url.protocol === 'http:' && !isLoopbackHost(url.hostname) && !allowInsecureHttp) {
    return {
      ok: false,
      error: 'Hosted Qwen endpoints must use HTTPS unless PRIVATE_QWEN_ALLOW_HTTP is explicitly enabled.',
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

  const historyEntries = input.history
    .slice(-Math.max(QWEN_HISTORY_MESSAGE_LIMIT * 2, QWEN_HISTORY_MESSAGE_LIMIT))
    .map((entry) => prepareHistoryEntry(entry, input.username, input.botName))
    .filter((entry): entry is QwenChatMessage => Boolean(entry));

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
      upstreamError: 'No Qwen model is configured. Set PRIVATE_QWEN_MODEL or configure it on the Private Chat page.',
    };
  }

  const messages = buildQwenMessages(input);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.apiKey?.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`;

  const body = {
    model: input.model.trim(),
    messages,
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    repetition_penalty: 1.05,
    max_tokens: configuredMaxTokens(),
    stream: false,
    stop: ['<|im_end|>', '<|endoftext|>'],
  };

  try {
    const response = await (input.fetchImpl || fetch)(target.endpoint, {
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

    return { text, provider, finishReason: finishReason || undefined };
  } catch (error) {
    return {
      text: '',
      provider,
      upstreamError: error instanceof Error ? error.message : String(error),
    };
  }
}
