import type { PrivateChatMessage } from '@/lib/private-chat-store';

const SEAART_API_BASE = 'https://www.seaart.ai/api/v1';
const SEAART_STREAM_URL = 'https://www.seaart.ai/api/stream/character/session/chat_new';
const SEAART_TOURIST_STREAM_URL = 'https://www.seaart.ai/api/stream/character/session/tourist_chat';
const SEAART_MODEL = 'Gemini-2.5-Flash-Preview-05-20';
const SEAART_TIMEOUT_MS = 60_000;

type FetchLike = typeof fetch;

export type SeaArtCharacterCompletion = {
  text: string;
  authMode?: 'account' | 'tourist';
  upstreamStatus?: number;
  upstreamError?: string;
};

function requestHeaders(input: { token?: string; deviceId: string; acceptsStream?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: input.acceptsStream ? 'text/event-stream' : 'application/json',
    'Content-Type': 'application/json',
    Origin: 'https://www.seaart.ai',
    Referer: 'https://www.seaart.ai/character/',
    'User-Agent': 'Mozilla/5.0 StreamWeaver SeaArt character-chat',
    'x-app-id': 'app_global_seaart',
    'x-device-id': input.deviceId,
  };
  if (input.token) headers.token = input.token;
  return headers;
}

export function stableSeaArtDeviceId(tenantId: string): string {
  // A stable UUID-shaped identifier keeps SeaArt's tourist quota honest across
  // requests and avoids creating a new anonymous identity for every message.
  const source = `streamweaver-seaart-character:${tenantId.trim() || 'default'}`;
  let hash = 2166136261;
  const bytes: number[] = [];
  for (let index = 0; index < 16; index++) {
    for (let cursor = index; cursor < source.length; cursor += 16) {
      hash ^= source.charCodeAt(cursor);
      hash = Math.imul(hash, 16777619);
    }
    bytes.push(hash >>> 24 & 0xff);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeSeaArtCharacterId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/character\/chat\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]).trim();
  } catch {
    // Raw character IDs are accepted as-is.
  }

  return trimmed;
}

export function buildSeaArtHistory(messages: PrivateChatMessage[]): Array<{ role: 1 | 2; content: string; msg_id: string }> {
  const history = messages
    .filter((message) => message.message.trim())
    .map((message) => ({
      role: (message.type === 'ai' ? 2 : 1) as 1 | 2,
      content: message.message.trim(),
      msg_id: '',
    }));

  // SeaArt ignores history that ends on a user turn. The SDK adds a blank
  // assistant turn for server compatibility, so mirror that contract here.
  if (history.length > 0 && history[history.length - 1].role !== 2) {
    history.push({ role: 2, content: ' ', msg_id: '' });
  }

  return history;
}

function envelopeValue(payload: any): any {
  return payload?.data?.data ?? payload?.data;
}

function envelopeError(payload: any): string {
  return String(payload?.status?.msg || payload?.message || payload?.error || 'SeaArt request failed');
}

type SeaArtStreamInspection = {
  text: string;
  error?: string;
  frameCount: number;
  shapes: string[];
};

function parseSeaArtFrames(raw: string): Array<{ value?: unknown; plainText?: string }> {
  const frames: Array<{ value?: unknown; plainText?: string }> = [];
  const blocks = raw.includes('data:')
    ? raw.split(/\r?\n\r?\n/)
    : raw.split(/\r?\n/);

  for (const block of blocks) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.trimStart().startsWith('data:'))
      .map((line) => line.trimStart().slice(5).trimStart());
    const data = (dataLines.length ? dataLines.join('\n') : block).trim();
    if (!data || data === '[DONE]') continue;

    try {
      frames.push({ value: JSON.parse(data) });
    } catch {
      // Some SeaArt stream variants send the visible token directly after
      // `data:` rather than wrapping it in JSON.
      if (dataLines.length) frames.push({ plainText: data });
    }
  }

  return frames;
}

function visibleContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    const record = part as Record<string, unknown>;
    return visibleContent(record.text ?? record.content ?? record.value);
  }).join('');
}

function frameText(value: unknown, depth = 0): string {
  if (!value || typeof value !== 'object' || depth > 5) return '';
  const payload = value as Record<string, any>;
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  const direct = [
    choice?.delta?.content,
    choice?.message?.content,
    choice?.text,
    payload.content,
    payload.text,
    payload.answer,
    payload.reply,
    typeof payload.message === 'string' ? payload.message : undefined,
  ];
  for (const candidate of direct) {
    const text = visibleContent(candidate);
    if (text) return text;
  }

  for (const key of ['data', 'result', 'response', 'output', 'msg', 'message']) {
    const text = frameText(payload[key], depth + 1);
    if (text) return text;
  }
  return '';
}

function frameError(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const payload = value as Record<string, any>;
  const code = payload.status?.code ?? payload.code;
  const error = payload.status?.msg ?? payload.error ?? payload.error_msg ?? payload.errorMessage;
  if (error && (code === undefined || ![0, 10000, 200].includes(Number(code)))) return String(error);
  for (const key of ['data', 'result']) {
    const nested = frameError(payload[key]);
    if (nested) return nested;
  }
  return '';
}

function appendStreamText(current: string, next: string): string {
  if (!next) return current;
  // SeaArt has used both token deltas ("Hel" + "lo") and cumulative snapshots
  // ("Hel" then "Hello"). Preserve either without duplicating snapshots.
  if (next.startsWith(current)) return next;
  if (current.startsWith(next)) return current;
  return current + next;
}

function stripSeaArtControlMetadata(value: string): string {
  // Character streams can append animation/voice timing tuples directly to
  // the dialogue, sometimes ending with a truncated tuple. Only remove a
  // suffix when it starts with a complete numeric tuple, contains another
  // tuple, and the entire remainder is numeric punctuation.
  const tuple = /\[\s*[+-]?\d+(?:\.\d+)?(?:\s*,\s*[+-]?\d+(?:\.\d+)?){3}\s*\]/g;
  for (const match of value.matchAll(tuple)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const suffix = value.slice(index).trim();
    const tupleStarts = suffix.match(/\[/g)?.length || 0;
    if (tupleStarts >= 2 && /^[\d+\-.,eE\s[\]]+$/.test(suffix)) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function inspectSeaArtStream(raw: string): SeaArtStreamInspection {
  const frames = parseSeaArtFrames(raw);
  const shapes = new Set<string>();
  let text = '';
  let error = '';

  for (const frame of frames) {
    if (frame.plainText) {
      shapes.add('plain');
      text = appendStreamText(text, frame.plainText);
      continue;
    }
    const value = frame.value;
    if (value && typeof value === 'object') {
      shapes.add(Object.keys(value as Record<string, unknown>).sort().slice(0, 6).join('+') || 'object');
    } else {
      shapes.add(typeof value);
    }
    text = appendStreamText(text, frameText(value));
    error ||= frameError(value);
  }

  return {
    text: stripSeaArtControlMetadata(text.trim()),
    error: error || undefined,
    frameCount: frames.length,
    shapes: [...shapes].slice(0, 6),
  };
}

export function extractSeaArtStreamText(raw: string): string {
  return inspectSeaArtStream(raw).text;
}

type SeaArtCharacterRequest = {
  token?: string;
  tenantId: string;
  characterId: string;
  message: string;
  history: PrivateChatMessage[];
  characterName?: string;
  fetchImpl?: FetchLike;
};

function isSeaArtAuthenticationError(error: string | undefined): boolean {
  if (!error) return false;
  return /\b(?:auth(?:entication)?|login|token|unauthori[sz]ed)\b.*\b(?:invalid|expired|required|failed|denied)\b/i.test(error)
    || /\b(?:invalid|expired)\b.*\btoken\b/i.test(error);
}

async function requestSeaArtCharacterCompletionOnce(input: SeaArtCharacterRequest): Promise<SeaArtCharacterCompletion> {
  const fetchImpl = input.fetchImpl || fetch;
  const characterId = normalizeSeaArtCharacterId(input.characterId);
  const token = input.token?.trim() || '';
  const deviceId = stableSeaArtDeviceId(input.tenantId);
  const authMode = token ? 'account' : 'tourist';
  let sessionId = '';

  if (!characterId) return { text: '', upstreamError: 'SeaArt character ID is not configured' };

  try {
    const createResponse = await fetchImpl(`${SEAART_API_BASE}/character/session/create`, {
      method: 'POST',
      headers: requestHeaders({ token, deviceId }),
      body: JSON.stringify({ character_id: characterId, mask: '' }),
      signal: AbortSignal.timeout(SEAART_TIMEOUT_MS),
    });
    const createText = await createResponse.text();
    let createPayload: any = {};
    try { createPayload = JSON.parse(createText); } catch {}

    if (!createResponse.ok || (createPayload?.status?.code && createPayload.status.code !== 10000)) {
      return {
        text: '',
        upstreamStatus: createResponse.status,
        upstreamError: envelopeError(createPayload) || createText.slice(0, 500),
      };
    }

    sessionId = String(envelopeValue(createPayload)?.session_id || '');
    if (!sessionId) {
      return { text: '', upstreamStatus: createResponse.status, upstreamError: 'SeaArt created no character session' };
    }

    const streamResponse = await fetchImpl(token ? SEAART_STREAM_URL : SEAART_TOURIST_STREAM_URL, {
      method: 'POST',
      headers: requestHeaders({ token, deviceId, acceptsStream: true }),
      body: JSON.stringify({
        content: input.message,
        session_id: sessionId,
        vip_only: 2,
        support_voice: 1,
        name: input.characterName || undefined,
        model: SEAART_MODEL,
        refer: 'v1',
        stream: true,
        messages: [{ role: 'text', content: input.message }],
        history_message: buildSeaArtHistory(input.history),
      }),
      signal: AbortSignal.timeout(SEAART_TIMEOUT_MS),
    });
    const streamText = await streamResponse.text();

    if (!streamResponse.ok) {
      return { text: '', upstreamStatus: streamResponse.status, upstreamError: streamText.slice(0, 500) };
    }

    const inspected = inspectSeaArtStream(streamText);
    if (inspected.text) return { text: inspected.text, authMode };
    if (inspected.error) {
      return { text: '', authMode, upstreamStatus: streamResponse.status, upstreamError: inspected.error };
    }

    const contentType = streamResponse.headers.get('content-type')?.split(';')[0] || 'unknown';
    return {
      text: '',
      authMode,
      upstreamStatus: streamResponse.status,
      upstreamError: `SeaArt character returned no visible text (content-type=${contentType}, bytes=${Buffer.byteLength(streamText)}, frames=${inspected.frameCount}, shapes=${inspected.shapes.join('|') || 'none'})`,
    };
  } catch (error) {
    return { text: '', upstreamError: error instanceof Error ? error.message : String(error) };
  } finally {
    if (sessionId) {
      fetchImpl(`${SEAART_API_BASE}/character/session/delete`, {
        method: 'POST',
        headers: requestHeaders({ token, deviceId }),
        body: JSON.stringify({ id: sessionId }),
        signal: AbortSignal.timeout(10_000),
      }).catch((error) => console.warn('[Private Chat API] SeaArt session cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

export async function requestSeaArtCharacterCompletion(
  input: SeaArtCharacterRequest,
): Promise<SeaArtCharacterCompletion> {
  const accountResult = await requestSeaArtCharacterCompletionOnce(input);
  if (!input.token?.trim() || !isSeaArtAuthenticationError(accountResult.upstreamError)) {
    return accountResult;
  }

  console.warn('[Private Chat API] SeaArt account token rejected; retrying character chat as tourist');
  return requestSeaArtCharacterCompletionOnce({ ...input, token: undefined });
}
