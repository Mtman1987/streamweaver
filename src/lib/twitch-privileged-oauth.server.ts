import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TWITCH_PRIVILEGED_OAUTH_COOKIE = 'streamweaver-twitch-privileged-oauth';
export const TWITCH_PRIVILEGED_OAUTH_MAX_AGE = 10 * 60;

export type PrivilegedTwitchOAuthRole = 'community-bot' | 'the-count';

type PrivilegedTwitchOAuthTransaction = {
  role: PrivilegedTwitchOAuthRole;
  ownerId: string;
  nonce: string;
  expiresAt: number;
};

function signingSecret(): string {
  const secret = String(process.env.STREAMWEAVER_SESSION_SECRET || '').trim();
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') {
    return String(process.env.STREAMWEAVER_CLIENT_SECRET || 'streamweaver-local-dev-session').trim();
  }
  throw new Error('STREAMWEAVER_SESSION_SECRET is required in production');
}

function signature(payload: string): Buffer {
  return createHmac('sha256', signingSecret())
    .update('twitch-privileged-oauth-v1:')
    .update(payload)
    .digest();
}

export function createPrivilegedTwitchOAuthTransaction(
  role: PrivilegedTwitchOAuthRole,
  ownerId: string,
): { state: string; cookieValue: string } {
  const nonce = randomBytes(32).toString('base64url');
  const transaction: PrivilegedTwitchOAuthTransaction = {
    role,
    ownerId: String(ownerId || '').trim(),
    nonce,
    expiresAt: Date.now() + TWITCH_PRIVILEGED_OAUTH_MAX_AGE * 1000,
  };
  if (!transaction.ownerId) throw new Error('Privileged Twitch OAuth requires an owner ID');

  const payload = Buffer.from(JSON.stringify(transaction)).toString('base64url');
  return {
    state: nonce,
    cookieValue: `${payload}.${signature(payload).toString('base64url')}`,
  };
}

export function readPrivilegedTwitchOAuthTransaction(
  cookieValue: string | undefined,
  returnedState: string,
  ownerId: string,
): PrivilegedTwitchOAuthTransaction | null {
  if (!cookieValue || !returnedState || !ownerId) return null;
  const [payload, encodedSignature, extra] = cookieValue.split('.');
  if (!payload || !encodedSignature || extra) return null;

  try {
    const provided = Buffer.from(encodedSignature, 'base64url');
    const expected = signature(payload);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

    const transaction = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as PrivilegedTwitchOAuthTransaction;

    if (
      (transaction.role !== 'community-bot' && transaction.role !== 'the-count') ||
      transaction.ownerId !== ownerId ||
      transaction.nonce !== returnedState ||
      !transaction.expiresAt ||
      transaction.expiresAt <= Date.now()
    ) {
      return null;
    }

    return transaction;
  } catch {
    return null;
  }
}
