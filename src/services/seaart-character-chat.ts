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

export function extractSeaArtStreamText(raw: string): string {
  const chunks: string[] = [];

  for (const block of raw.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();

    if (!data || data === '[DONE]') continue;

    try {
      const parsed = JSON.parse(data);
      const content = parsed?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content) chunks.push(content);
    } catch {
      // Ignore keepalives and non-JSON SSE events.
    }
  }

  return chunks.join('').trim();
}

export async function requestSeaArtCharacterCompletion(input: {
  token?: string;
  tenantId: string;
  characterId: string;
  message: string;
  history: PrivateChatMessage[];
  characterName?: string;
  fetchImpl?: FetchLike;
}): Promise<SeaArtCharacterCompletion> {
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

    const text = extractSeaArtStreamText(streamText);
    return text
      ? { text, authMode }
      : { text: '', authMode, upstreamStatus: streamResponse.status, upstreamError: 'SeaArt character returned no visible text' };
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
