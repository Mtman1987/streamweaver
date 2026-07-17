type EdgeSession = { id?: string; username?: string; expiresAt?: number };
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function verifySessionCookieEdge(value: string | undefined): Promise<EdgeSession | null> {
  if (!value) return null;
  const [payload, encodedSignature, extra] = value.split('.');
  if (!payload || !encodedSignature || extra) return null;
  const secret = String(process.env.STREAMWEAVER_SESSION_SECRET || (process.env.NODE_ENV !== 'production' ? process.env.STREAMWEAVER_CLIENT_SECRET || 'streamweaver-local-dev-session' : '')).trim();
  if (!secret) return null;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signature = decodeBase64Url(encodedSignature);
    const valid = await crypto.subtle.verify('HMAC', key, Uint8Array.from(signature).buffer, new TextEncoder().encode(payload));
    if (!valid) return null;
    const session = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as EdgeSession;
    if (!session.id || !session.username || !session.expiresAt || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function serializeSessionCookieEdge(session: Record<string, unknown>): Promise<string> {
  const secret = String(process.env.STREAMWEAVER_SESSION_SECRET || (process.env.NODE_ENV !== 'production' ? process.env.STREAMWEAVER_CLIENT_SECRET || 'streamweaver-local-dev-session' : '')).trim();
  if (!secret || !session.id || !session.username) throw new Error('Signed session configuration is unavailable');
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    ...session,
    expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  })));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  const encodedSignature = encodeBase64Url(signature);
  return `${payload}.${encodedSignature}`;
}

export const STREAMWEAVER_EDGE_SESSION_MAX_AGE = SESSION_MAX_AGE_SECONDS;
