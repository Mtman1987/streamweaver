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

export type TwitchCredentialRole = 'broadcaster' | 'bot' | 'community-bot';

export interface TwitchCredentialQuarantine {
  provider: 'twitch';
  role: TwitchCredentialRole;
  status: 'quarantined';
  reason: 'reauthorization_required';
  quarantinedAt: string;
  deleteAfter: string;
  revision: string;
}

export const TWITCH_CREDENTIAL_RETENTION_DAYS = 90;
const TWITCH_CREDENTIAL_RETENTION_MS = TWITCH_CREDENTIAL_RETENTION_DAYS * 24 * 60 * 60 * 1000;

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
  credentialQuarantine?: Partial<Record<TwitchCredentialRole, TwitchCredentialQuarantine>>;
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

const roleKeys: Record<TwitchCredentialRole, {
  token: keyof StoredTokens;
  refresh: keyof StoredTokens;
  expiry: keyof StoredTokens;
  username: keyof StoredTokens;
  profile: keyof StoredTokens;
  avatar: keyof StoredTokens;
}> = {
  broadcaster: {
    token: 'broadcasterToken',
    refresh: 'broadcasterRefreshToken',
    expiry: 'broadcasterTokenExpiry',
    username: 'broadcasterUsername',
    profile: 'broadcasterProfileImageUrl',
    avatar: 'broadcasterAvatarUrl',
  },
  bot: {
    token: 'botToken',
    refresh: 'botRefreshToken',
    expiry: 'botTokenExpiry',
    username: 'botUsername',
    profile: 'botProfileImageUrl',
    avatar: 'botAvatarUrl',
  },
  'community-bot': {
    token: 'communityBotToken',
    refresh: 'communityBotRefreshToken',
    expiry: 'communityBotTokenExpiry',
    username: 'communityBotUsername',
    profile: 'communityBotProfileImageUrl',
    avatar: 'communityBotAvatarUrl',
  },
};

function credentialRevision(tokens: StoredTokens, role: TwitchCredentialRole): string {
  const keys = roleKeys[role];
  return createHash('sha256').update([
    String(tokens[keys.token] || ''),
    String(tokens[keys.refresh] || ''),
    String(tokens[keys.expiry] || ''),
  ].join(':')).digest('hex');
}

function currentQuarantine(
  tokens: StoredTokens,
  role: TwitchCredentialRole,
): TwitchCredentialQuarantine | null {
  const entry = tokens.credentialQuarantine?.[role];
  if (!entry || entry.status !== 'quarantined') return null;
  return entry.revision === credentialRevision(tokens, role) ? entry : null;
}

function clearStaleQuarantines(tokens: StoredTokens): StoredTokens {
  if (!tokens.credentialQuarantine) return tokens;
  const credentialQuarantine = { ...tokens.credentialQuarantine };
  for (const role of Object.keys(credentialQuarantine) as TwitchCredentialRole[]) {
    if (!currentQuarantine(tokens, role)) delete credentialQuarantine[role];
  }
  if (Object.keys(credentialQuarantine).length === 0) {
    const { credentialQuarantine: _discarded, ...rest } = tokens;
    return rest;
  }
  return { ...tokens, credentialQuarantine };
}

function quarantinedTokens(
  tokens: StoredTokens,
  role: TwitchCredentialRole,
  now = Date.now(),
): StoredTokens {
  const existing = currentQuarantine(tokens, role);
  if (existing) return tokens;
  const quarantinedAt = new Date(now).toISOString();
  return {
    ...tokens,
    credentialQuarantine: {
      ...tokens.credentialQuarantine,
      [role]: {
        provider: 'twitch',
        role,
        status: 'quarantined',
        reason: 'reauthorization_required',
        quarantinedAt,
        deleteAfter: new Date(now + TWITCH_CREDENTIAL_RETENTION_MS).toISOString(),
        revision: credentialRevision(tokens, role),
      },
    },
  };
}

export function getTwitchCredentialQuarantine(
  tokens: StoredTokens | null | undefined,
  role: TwitchCredentialRole,
): TwitchCredentialQuarantine | null {
  return tokens ? currentQuarantine(tokens, role) : null;
}

export function isTwitchCredentialQuarantined(
  tokens: StoredTokens | null | undefined,
  role: TwitchCredentialRole,
): boolean {
  return Boolean(getTwitchCredentialQuarantine(tokens, role));
}

export class TwitchCredentialQuarantinedError extends Error {
  readonly code = 'TWITCH_CREDENTIAL_QUARANTINED';

  constructor(readonly role: TwitchCredentialRole, readonly deleteAfter: string) {
    super(`Twitch ${role} credential is quarantined; reauthorization is required before ${deleteAfter}`);
    this.name = 'TwitchCredentialQuarantinedError';
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
    // A newly-authorized role changes its credential revision, releasing only that role.
    await writeTokensFile(file, clearStaleQuarantines(next));
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
  return /login authentication failed|authentication failed|invalid oauth|bad auth|invalid refresh token|credential is quarantined|reauthorization is required/i.test(message);
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
  const quarantine = currentQuarantine(tokens, tokenType);
  if (quarantine) {
    throw new TwitchCredentialQuarantinedError(tokenType, quarantine.deleteAfter);
  }

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
  let newTokenData: TokenData;
  try {
    newTokenData = await refreshAccessToken(refreshToken, clientId, clientSecret);
  } catch (error) {
    if (isTwitchAuthFailure(error)) {
      const quarantined = quarantinedTokens(tokens, tokenType);
      await writeTokensFile(getStorageTarget(tokenType, tenantId), quarantined);
      const entry = currentQuarantine(quarantined, tokenType)!;
      console.warn(`[Token] ${tokenType} credential quarantined until ${entry.deleteAfter}; automatic retries stopped`);
    }
    throw error;
  }
  const newExpiry = now + (newTokenData.expires_in - 60) * 1000;

  // A different role may have rotated since this caller loaded its snapshot.
  const currentTokens = await readCurrentTokensForType(tokenType, tokens, tenantId);
  const updatedTokens: StoredTokens = {
    ...currentTokens,
    [tokenKey]: newTokenData.access_token,
    [refreshTokenKey]: newTokenData.refresh_token || refreshToken,
    [expiryKey]: newExpiry,
    lastUpdated: new Date().toISOString(),
    credentialQuarantine: tokens.credentialQuarantine,
  };

  if (tokenType === 'broadcaster' && tokens.loginUsername && tokens.broadcasterUsername &&
      tokens.loginUsername.toLowerCase() === tokens.broadcasterUsername.toLowerCase()) {
    updatedTokens.loginToken = newTokenData.access_token;
    updatedTokens.loginRefreshToken = newTokenData.refresh_token || refreshToken;
    updatedTokens.loginTokenExpiry = newExpiry;
  }

  const cleanedTokens = clearStaleQuarantines(updatedTokens);
  if (tokenType === 'community-bot' && !tenantId) {
    const filePath = communityTokensFilePath();
    await writeTokensFile(filePath, cleanedTokens);
  } else {
    await writeTokensFile(tokensFilePath(tenantId), cleanedTokens);
  }

  console.log(`[Token] Successfully refreshed ${tokenType} token`);
  accessToken = newTokenData.access_token;
  return accessToken;
}

export async function purgeExpiredTwitchCredentials(
  tenantId: string,
  now = Date.now(),
): Promise<TwitchCredentialRole[]> {
  const file = tokensFilePath(tenantId);
  return serializeStorage(file, async () => {
    let tokens: StoredTokens;
    try {
      tokens = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }

    const purged: TwitchCredentialRole[] = [];
    for (const role of ['broadcaster', 'bot'] as const) {
      const quarantine = currentQuarantine(tokens, role);
      if (!quarantine || Date.parse(quarantine.deleteAfter) > now) continue;
      const keys = roleKeys[role];
      const refreshToken = tokens[keys.refresh];
      for (const key of Object.values(keys)) delete tokens[key];

      if (role === 'broadcaster' && refreshToken && tokens.loginRefreshToken === refreshToken) {
        delete tokens.loginToken;
        delete tokens.loginRefreshToken;
        delete tokens.loginTokenExpiry;
      }

      if (tokens.credentialQuarantine) delete tokens.credentialQuarantine[role];
      purged.push(role);
    }

    if (purged.length === 0) return purged;
    if (tokens.credentialQuarantine && Object.keys(tokens.credentialQuarantine).length === 0) {
      delete tokens.credentialQuarantine;
    }
    tokens.lastUpdated = new Date(now).toISOString();
    await writeTokensFile(file, tokens);
    return purged;
  });
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
