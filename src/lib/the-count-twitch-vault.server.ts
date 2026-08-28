import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import { globalPath } from './tenant';
import { THE_COUNT_TWITCH_LOGIN } from './the-count';

const VAULT_MAGIC = Buffer.from('TCV1');
const VAULT_AAD = Buffer.from('streamweaver:the-count:twitch:v1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type TheCountTwitchCredential = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  login: string;
  scopes: string[];
  updatedAt: string;
};

let refreshInFlight: Promise<string> | null = null;

function vaultPath(): string {
  return globalPath('credentials/the-count-twitch.vault');
}

function rootSecret(): string {
  const secret = String(process.env.STREAMWEAVER_SESSION_SECRET || '').trim();
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') {
    return String(process.env.STREAMWEAVER_CLIENT_SECRET || 'streamweaver-local-dev-session').trim();
  }
  throw new Error('STREAMWEAVER_SESSION_SECRET is required in production');
}

function vaultKey(): Buffer {
  return createHmac('sha256', rootSecret())
    .update('streamweaver:the-count:twitch:v1')
    .digest();
}

function normalizeLogin(value: unknown): string {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function assertCredential(value: Partial<TheCountTwitchCredential>): asserts value is TheCountTwitchCredential {
  if (
    !value.accessToken ||
    !value.refreshToken ||
    !value.userId ||
    !value.login ||
    !Number.isFinite(value.expiresAt)
  ) {
    throw new Error('The Count Twitch credential is incomplete');
  }
  if (normalizeLogin(value.login) !== THE_COUNT_TWITCH_LOGIN) {
    throw new Error(`The Count Twitch credential must belong to @${THE_COUNT_TWITCH_LOGIN}`);
  }
}

function sealCredential(credential: TheCountTwitchCredential): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', vaultKey(), iv);
  cipher.setAAD(VAULT_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credential), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([VAULT_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function openCredential(payload: Buffer): TheCountTwitchCredential {
  const minimumBytes = VAULT_MAGIC.length + IV_BYTES + TAG_BYTES + 1;
  if (payload.length < minimumBytes || !payload.subarray(0, VAULT_MAGIC.length).equals(VAULT_MAGIC)) {
    throw new Error('The Count Twitch credential vault is invalid');
  }

  const ivStart = VAULT_MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    vaultKey(),
    payload.subarray(ivStart, tagStart),
  );
  decipher.setAAD(VAULT_AAD);
  decipher.setAuthTag(payload.subarray(tagStart, ciphertextStart));
  const plaintext = Buffer.concat([
    decipher.update(payload.subarray(ciphertextStart)),
    decipher.final(),
  ]).toString('utf8');
  const credential = JSON.parse(plaintext) as TheCountTwitchCredential;
  assertCredential(credential);
  credential.login = normalizeLogin(credential.login);
  credential.scopes = Array.isArray(credential.scopes)
    ? credential.scopes.map((scope) => String(scope))
    : [];
  return credential;
}

async function writeCredential(credential: TheCountTwitchCredential): Promise<void> {
  assertCredential(credential);
  const filePath = vaultPath();
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomBytes(8).toString('hex')}.tmp`;
  await fs.writeFile(temporaryPath, sealCredential(credential), { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
  await fs.chmod(filePath, 0o600).catch(() => {});
}

export async function readTheCountTwitchCredential(): Promise<TheCountTwitchCredential | null> {
  try {
    return openCredential(await fs.readFile(vaultPath()));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function storeTheCountTwitchCredential(
  credential: TheCountTwitchCredential,
): Promise<void> {
  const normalized: TheCountTwitchCredential = {
    ...credential,
    login: normalizeLogin(credential.login),
    userId: String(credential.userId || '').trim(),
    scopes: Array.isArray(credential.scopes)
      ? credential.scopes.map((scope) => String(scope))
      : [],
  };
  assertCredential(normalized);

  const existing = await readTheCountTwitchCredential();
  if (existing?.userId && existing.userId !== normalized.userId) {
    throw new Error('The Count Twitch identity is already pinned to a different Twitch user ID');
  }

  await writeCredential(normalized);
}

async function validateIdentity(
  accessToken: string,
): Promise<{ userId: string; login: string } | null> {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${accessToken.replace(/^oauth:/, '')}` },
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(5000)
        : undefined,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return {
      userId: String(payload?.user_id || '').trim(),
      login: normalizeLogin(payload?.login),
    };
  } catch {
    return null;
  }
}

async function refreshCredential(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const credential = await readTheCountTwitchCredential();
  if (!credential) throw new Error('The Count Twitch account is not authorized');

  const identity = await validateIdentity(credential.accessToken);
  if (
    credential.expiresAt - Date.now() > REFRESH_BUFFER_MS &&
    identity?.userId === credential.userId &&
    identity.login === THE_COUNT_TWITCH_LOGIN
  ) {
    return credential.accessToken;
  }

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
    }),
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(8000)
      : undefined,
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.access_token) {
    throw new Error(`Failed to refresh The Count Twitch credential (HTTP ${response.status})`);
  }

  const refreshedIdentity = await validateIdentity(payload.access_token);
  if (
    refreshedIdentity?.userId !== credential.userId ||
    refreshedIdentity.login !== THE_COUNT_TWITCH_LOGIN
  ) {
    throw new Error('Refreshed The Count Twitch token failed its pinned identity check');
  }

  const refreshed: TheCountTwitchCredential = {
    ...credential,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || credential.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 0) - 60) * 1000,
    scopes: Array.isArray(payload.scope) ? payload.scope.map((scope: unknown) => String(scope)) : credential.scopes,
    updatedAt: new Date().toISOString(),
  };
  await writeCredential(refreshed);
  return refreshed.accessToken;
}

export async function ensureValidTheCountTwitchToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  const run = refreshCredential(clientId, clientSecret).finally(() => {
    if (refreshInFlight === run) refreshInFlight = null;
  });
  refreshInFlight = run;
  return run;
}

export async function getTheCountTwitchCredentialStatus(): Promise<{
  configured: boolean;
  login: string | null;
}> {
  const credential = await readTheCountTwitchCredential();
  return {
    configured: Boolean(credential),
    login: credential?.login || null,
  };
}
