import { promises as fs } from 'fs';
import { resolve } from 'path';
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

export class ProactiveTwitchRefreshGate {
  private readonly blockedRevisions = new Map<string, string>();

  revision(tokens: StoredTokens): string {
    return [
      tokens.lastUpdated || '',
      tokens.broadcasterTokenExpiry || '',
      tokens.botTokenExpiry || '',
    ].join(':');
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
  const dir = resolve(filePath, '..');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(tokens, null, 2));
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
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} ${response.statusText} - ${errorData}`);
  }

  return await response.json();
}

export function isTwitchAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /login authentication failed|authentication failed|invalid oauth|bad auth|invalid refresh token|failed to refresh token/i.test(message);
}

export async function validateAccessToken(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.ok;
  } catch {
    return false;
  }
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
  tenantId?: string
): Promise<string> {
  const tokenKey = tokenType === 'broadcaster' ? 'broadcasterToken' : tokenType === 'bot' ? 'botToken' : 'communityBotToken';
  const refreshTokenKey = tokenType === 'broadcaster' ? 'broadcasterRefreshToken' : tokenType === 'bot' ? 'botRefreshToken' : 'communityBotRefreshToken';
  const expiryKey = tokenType === 'broadcaster' ? 'broadcasterTokenExpiry' : tokenType === 'bot' ? 'botTokenExpiry' : 'communityBotTokenExpiry';

  const tokens = await readCurrentTokensForType(tokenType, fallbackTokens, tenantId);
  let accessToken = tokens[tokenKey];
  const refreshToken = tokens[refreshTokenKey];
  const tokenExpiry = tokens[expiryKey];

  if (!accessToken || !refreshToken) {
    throw new Error(`Missing ${tokenType} token or refresh token`);
  }

  const now = Date.now();
  const isExpired = !tokenExpiry || tokenExpiry - now < 5 * 60 * 1000;
  let needsRefresh = isExpired;

  if (!needsRefresh) {
    const isValid = await validateAccessToken(accessToken);
    needsRefresh = !isValid;
  }

  if (!needsRefresh) {
    return accessToken;
  }

  console.log(`[Token] ${tokenType} token is invalid or expired, refreshing...`);
  const newTokenData = await refreshAccessToken(refreshToken, clientId, clientSecret);
  const newExpiry = now + (newTokenData.expires_in - 60) * 1000;

  const updatedTokens: StoredTokens = {
    ...tokens,
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
    const dir = resolve(filePath, '..');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(updatedTokens, null, 2));
  } else {
    await storeTokens(updatedTokens, tenantId);
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
  const tokens = await readCurrentTokensForType(tokenType, {}, tenantId);
  const refreshTokenKey = tokenType === 'broadcaster' ? 'broadcasterRefreshToken' : tokenType === 'bot' ? 'botRefreshToken' : 'communityBotRefreshToken';
  const tokenKey = tokenType === 'broadcaster' ? 'broadcasterToken' : tokenType === 'bot' ? 'botToken' : 'communityBotToken';
  if (!tokens[refreshTokenKey] || !tokens[tokenKey]) {
    throw new Error(`Missing ${tokenType} token or refresh token`);
  }

  const expiryKey = tokenType === 'broadcaster' ? 'broadcasterTokenExpiry' : tokenType === 'bot' ? 'botTokenExpiry' : 'communityBotTokenExpiry';
  const forcedTokens: StoredTokens = {
    ...tokens,
    [expiryKey]: 0,
  };
  return refreshStoredToken(clientId, clientSecret, tokenType, forcedTokens, tenantId);
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

  const run = refreshStoredToken(clientId, clientSecret, tokenType, tokens, tenantId)
    .finally(() => {
      if (refreshLocks.get(lockKey) === run) {
        refreshLocks.delete(lockKey);
      }
    });

  refreshLocks.set(lockKey, run);
  return run;
}
