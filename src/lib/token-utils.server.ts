import { promises as fs } from 'fs';
import { resolve } from 'path';
import { randomUUID, createHash } from 'node:crypto';
import { tenantPath, communityBotTokensPath } from './tenant';

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface StoredTokens {
  broadcasterToken?: string;
  botToken?: string;
  communityBotToken?: string;
  loginToken?: string;
  broadcasterRefreshToken?: string;
  botRefreshToken?: string;
  communityBotRefreshToken?: string;
  loginRefreshToken?: string;
  broadcasterUsername?: string;
  botUsername?: string;
  communityBotUsername?: string;
  loginUsername?: string;
  broadcasterProfileImageUrl?: string;
  botProfileImageUrl?: string;
  communityBotProfileImageUrl?: string;
  loginProfileImageUrl?: string;
  broadcasterAvatarUrl?: string;
  botAvatarUrl?: string;
  communityBotAvatarUrl?: string;
  loginAvatarUrl?: string;
  twitchClientId?: string;
  twitchClientSecret?: string;
  broadcasterTokenExpiry?: number;
  botTokenExpiry?: number;
  communityBotTokenExpiry?: number;
  loginTokenExpiry?: number;
  lastUpdated?: string;
}

const refreshLocks = new Map<string, Promise<string>>();
const storageQueues = new Map<string, Promise<unknown>>();
const storageLeases = new Map<string, { error?: Error }>();
const lockfile = require('proper-lockfile');

function serializeStorage<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const previous = storageQueues.get(file) || Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    await fs.mkdir(resolve(file, '..'), { recursive: true });
    const lease: { error?: Error } = {};
    const release = await lockfile.lock(file, {
      realpath: false, stale: 60000, update: 10000,
      retries: { retries: 120, factor: 1, minTimeout: 250, maxTimeout: 250 },
      onCompromised: (error: Error) => { lease.error = error; },
    });
    storageLeases.set(file, lease);
    try {
      return await operation();
    } finally {
      storageLeases.delete(file);
      await release();
    }
  });
  storageQueues.set(file, run);
  void run.finally(() => { if (storageQueues.get(file) === run) storageQueues.delete(file); }).catch(() => {});
  return run;
}

async function writeTokensFile(file: string, tokens: StoredTokens): Promise<void> {
  if (storageLeases.get(file)?.error) throw storageLeases.get(file)!.error;
  await fs.mkdir(resolve(file, '..'), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    if (storageLeases.get(file)?.error) throw storageLeases.get(file)!.error;
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

export class ProactiveTwitchRefreshGate {
  private readonly blockedRevisions = new Map<string, string>();

  revision(tokens: StoredTokens): string {
    return createHash('sha256').update([
      tokens.lastUpdated || '',
      tokens.broadcasterTokenExpiry || '',
      tokens.botTokenExpiry || '',
      tokens.broadcasterToken || '',
      tokens.broadcasterRefreshToken || '',
      tokens.botToken || '',
      tokens.botRefreshToken || '',
    ].join(':')).digest('hex');
  }

  shouldAttempt(tenantId: string, tokens: StoredTokens): boolean {
    return this.blockedRevisions.get(tenantId) !== this.revision(tokens);
  }

  markReauthorizationRequired(tenantId: string, tokens: StoredTokens): void {
    this.blockedRevisions.set(tenantId, this.revision(tokens));
  }

  markSuccessful(tenantId: string): void {
    this.blockedRevisions.delete(tenantId);
  }
}

function tokensFilePath(tenantId?: string): string {
  if (tenantId) {
    return tenantPath(tenantId, 'tokens/twitch-tokens.json');
  }
  return resolve(process.cwd(), 'tokens', 'twitch-tokens.json');
}

function communityTokensFilePath(): string {
  return communityBotTokensPath();
}

function getStorageTarget(tokenType: 'broadcaster' | 'bot' | 'community-bot', tenantId?: string): string {
  return tokenType === 'community-bot' && !tenantId
    ? communityTokensFilePath()
    : tokensFilePath(tenantId);
}

export async function getStoredTokens(tenantId?: string): Promise<StoredTokens | null> {
  try {
    const data = await fs.readFile(tokensFilePath(tenantId), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function storeTokens(tokens: StoredTokens, tenantId?: string): Promise<void> {
  const filePath = tokensFilePath(tenantId);
  await serializeStorage(filePath, () => writeTokensFile(filePath, tokens));
}

/** All OAuth callbacks and disconnects share the refresh writer's file lock. */
export async function updateStoredTokens(
  update: Partial<StoredTokens> | ((current: StoredTokens) => StoredTokens),
  tenantId?: string,
  community = false,
): Promise<void> {
  const file = community ? communityTokensFilePath() : tokensFilePath(tenantId);
  await serializeStorage(file, async () => {
    let current: StoredTokens = {};
    try { current = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    const next = typeof update === 'function' ? update(current) : { ...current, ...update };
    await writeTokensFile(file, next);
  });
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<TokenData> {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} ${response.statusText} - ${errorData}`);
  }

  return await response.json();
}

export function isTwitchAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /login authentication failed|authentication failed|invalid oauth|bad auth|invalid refresh token/i.test(message);
}

export async function validateAccessToken(accessToken: string): Promise<boolean> {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `Bearer ${accessToken.replace(/^oauth:/, '')}` },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401) return false;
  if (!response.ok) throw new Error(`Twitch token validation temporarily unavailable (HTTP ${response.status})`);
  return true;
}

async function readCurrentTokensForType(
  tokenType: 'broadcaster' | 'bot' | 'community-bot',
  fallbackTokens: StoredTokens,
  tenantId?: string
): Promise<StoredTokens> {
  const filePath = getStorageTarget(tokenType, tenantId);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallbackTokens;
  }
}

async function refreshStoredToken(
  clientId: string,
  clientSecret: string,
  tokenType: 'broadcaster' | 'bot' | 'community-bot',
  fallbackTokens: StoredTokens,
  tenantId?: string,
  force = false,
): Promise<string> {
  const tokenKey = tokenType === 'broadcaster' ? 'broadcasterToken' : tokenType === 'bot' ? 'botToken' : 'communityBotToken';
  const refreshTokenKey = tokenType === 'broadcaster' ? 'broadcasterRefreshToken' : tokenType === 'bot' ? 'botRefreshToken' : 'communityBotRefreshToken';
  const expiryKey = tokenType === 'broadcaster' ? 'broadcasterTokenExpiry' : tokenType === 'bot' ? 'botTokenExpiry' : 'communityBotTokenExpiry';

  const tokens = await readCurrentTokensForType(tokenType, fallbackTokens, tenantId);
  let accessToken = tokens[tokenKey];
  const refreshToken = tokens[refreshTokenKey];
  const tokenExpiry = tokens[expiryKey];

  if (!accessToken && !refreshToken) {
    throw new Error(`Missing ${tokenType} token or refresh token`);
  }

  const now = Date.now();
  const isExpired = Boolean(tokenExpiry && tokenExpiry - now < 5 * 60 * 1000);
  let needsRefresh = force || !accessToken || (isExpired && Boolean(refreshToken));

  if (!needsRefresh) {
    const isValid = await validateAccessToken(accessToken!);
    needsRefresh = !isValid;
  }

  if (!needsRefresh) {
    return accessToken!;
  }

  if (!refreshToken) throw new Error(`Invalid OAuth: ${tokenType} token expired and no refresh token is stored`);

  console.log(`[Token] ${tokenType} token is invalid or expired, refreshing...`);
  const newTokenData = await refreshAccessToken(refreshToken, clientId, clientSecret);
  const newExpiry = now + (newTokenData.expires_in - 60) * 1000;

  // A different role may have rotated since this caller loaded its snapshot.
  const currentTokens = await readCurrentTokensForType(tokenType, tokens, tenantId);
  const updatedTokens: StoredTokens = {
    ...currentTokens,
    [tokenKey]: newTokenData.access_token,
    [refreshTokenKey]: newTokenData.refresh_token || refreshToken,
    [expiryKey]: newExpiry,
    lastUpdated: new Date().toISOString(),
  };

  if (tokenType === 'broadcaster' && tokens.loginUsername && tokens.broadcasterUsername &&
      tokens.loginUsername.toLowerCase() === tokens.broadcasterUsername.toLowerCase()) {
    updatedTokens.loginToken = newTokenData.access_token;
    updatedTokens.loginRefreshToken = newTokenData.refresh_token || refreshToken;
    updatedTokens.loginTokenExpiry = newExpiry;
  }

  if (tokenType === 'community-bot' && !tenantId) {
    const filePath = communityTokensFilePath();
    await writeTokensFile(filePath, updatedTokens);
  } else {
    await writeTokensFile(tokensFilePath(tenantId), updatedTokens);
  }

  console.log(`[Token] Successfully refreshed ${tokenType} token`);
  accessToken = newTokenData.access_token;
  return accessToken;
}

export async function forceRefreshStoredToken(
  clientId: string,
  clientSecret: string,
  tokenType: 'broadcaster' | 'bot' | 'community-bot',
  tenantId?: string
): Promise<string> {
  return serializeStorage(getStorageTarget(tokenType, tenantId), () =>
    refreshStoredToken(clientId, clientSecret, tokenType, {}, tenantId, true));
}

export async function ensureValidToken(
  clientId: string,
  clientSecret: string,
  tokenType: 'broadcaster' | 'bot' | 'community-bot',
  tokens: StoredTokens,
  tenantId?: string
): Promise<string> {
  const lockKey = `${getStorageTarget(tokenType, tenantId)}::${tokenType}`;
  const inFlight = refreshLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const run = serializeStorage(getStorageTarget(tokenType, tenantId), () =>
    refreshStoredToken(clientId, clientSecret, tokenType, tokens, tenantId))
    .finally(() => {
      if (refreshLocks.get(lockKey) === run) {
        refreshLocks.delete(lockKey);
      }
    });

  refreshLocks.set(lockKey, run);
  return run;
}
