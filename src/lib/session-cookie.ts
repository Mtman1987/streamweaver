import { createHmac, timingSafeEqual } from 'node:crypto';

export type StreamWeaverSession = {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
  spmtUserId?: string;
  identityProvider?: string;
  loginTime?: number;
  expiresAt?: number;
};

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function sessionSecret(): string {
  const secret = String(process.env.STREAMWEAVER_SESSION_SECRET || '').trim();
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') {
    return String(process.env.STREAMWEAVER_CLIENT_SECRET || 'streamweaver-local-dev-session').trim();
  }
  throw new Error('STREAMWEAVER_SESSION_SECRET is required in production');
}

function signature(payload: string): Buffer {
  return createHmac('sha256', sessionSecret()).update(payload).digest();
}

export function serializeSessionCookie(session: StreamWeaverSession): string {
  if (!session.id || !session.username) throw new Error('Session requires immutable ID and username');
  const payload = Buffer.from(JSON.stringify({
    ...session,
    expiresAt: session.expiresAt || Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  })).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

export function parseSessionCookie(value: string | undefined): StreamWeaverSession | null {
  if (!value) return null;
  const [payload, encodedSignature, extra] = value.split('.');
  if (!payload || !encodedSignature || extra) return null;
  try {
    const provided = Buffer.from(encodedSignature, 'base64url');
    const expected = signature(payload);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StreamWeaverSession;
    if (!session.id || !session.username || !session.expiresAt || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export const STREAMWEAVER_SESSION_MAX_AGE = SESSION_MAX_AGE_SECONDS;
