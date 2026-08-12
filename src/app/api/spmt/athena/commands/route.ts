import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { bootstrapTenant } from '@/lib/tenant';
import { serializeSessionCookie } from '@/lib/session-cookie';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

type SpmtUser = {
  id: string;
  username: string;
  displayName?: string;
  display_name?: string;
  avatarUrl?: string;
  avatar_url?: string;
  twitchId?: string;
  twitch_id?: string;
  twitchUsername?: string;
  twitch_username?: string;
};

function bearerToken(request: NextRequest): string {
  const header = String(request.headers.get('authorization') || '').trim();
  return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : '';
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

async function resolveSpmtUser(token: string): Promise<SpmtUser | null> {
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null) as any;
  const user = payload?.user || payload?.profile || payload;
  if (!user?.id || !user?.username) return null;
  return user as SpmtUser;
}

function internalSessionCookie(user: SpmtUser) {
  const tenantId = firstString(user.twitchId, user.twitch_id, user.id);
  const username = firstString(user.twitchUsername, user.twitch_username, user.username);
  const displayName = firstString(user.displayName, user.display_name, username);
  const avatar = firstString(user.avatarUrl, user.avatar_url);
  const value = serializeSessionCookie({
    id: tenantId,
    spmtUserId: user.id,
    identityProvider: 'spmt',
    username,
    displayName,
    avatar,
    loginTime: Date.now(),
  });
  return {
    tenantId,
    username,
    displayName,
    header: `streamweaver-session=${encodeURIComponent(value)}`,
  };
}

async function postInternal(request: NextRequest, path: string, cookie: string, body: unknown) {
  const response = await fetch(new URL(path, request.nextUrl.origin), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45000) : undefined,
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: response.ok, status: response.status, data, text };
}

export async function POST(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) {
    return apiError('SPMT authentication required', { status: 401, code: 'SPMT_AUTH_REQUIRED' });
  }

  const user = await resolveSpmtUser(token);
  if (!user) {
    return apiError('SPMT session is invalid or expired', { status: 401, code: 'SPMT_AUTH_INVALID' });
  }

  const body = await request.json().catch(() => null) as any;
  const command = firstString(body?.command, body?.message, body?.transcript).slice(0, 5000);
  if (!command) {
    return apiError('command is required', { status: 400, code: 'COMMAND_REQUIRED' });
  }

  const session = internalSessionCookie(user);
  await bootstrapTenant(session.tenantId, session.username);

  const ai = await postInternal(request, '/api/ai/chat-with-memory', session.header, {
    username: session.username,
    userId: user.id,
    displayName: session.displayName,
    message: command,
    tenantId: session.tenantId,
    context: 'voice',
  });

  if (!ai.ok) {
    return apiError(
      String(ai.data?.error?.message || ai.data?.error || ai.text || 'StreamWeaver Athena failed'),
      { status: ai.status >= 400 && ai.status < 600 ? ai.status : 502, code: 'ATHENA_UPSTREAM_FAILED' },
    );
  }

  const responseText = firstString(ai.data?.response, ai.data?.data?.response);
  let tts: any = null;
  if (responseText && body?.speak !== false) {
    const ttsResult = await postInternal(request, '/api/tts', session.header, {
      text: responseText,
      voice: firstString(body?.voice) || undefined,
      tenantId: session.tenantId,
    });
    tts = ttsResult.ok
      ? { ok: true, audioDataUri: firstString(ttsResult.data?.audioDataUri, ttsResult.data?.data?.audioDataUri) }
      : { ok: false, status: ttsResult.status, error: firstString(ttsResult.data?.error?.message, ttsResult.data?.error, ttsResult.text) };
  }

  return apiOk({
    accepted: true,
    routed: true,
    status: 'completed',
    command,
    response: responseText,
    research: ai.data?.research || ai.data?.data?.research || undefined,
    tts,
    identity: {
      spmtUserId: user.id,
      tenantId: session.tenantId,
      username: session.username,
      displayName: session.displayName,
    },
    source: firstString(body?.source, body?.sourceApp) || 'spmt-athena',
    roomId: firstString(body?.roomId) || undefined,
  });
}
