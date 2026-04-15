import { promises as fs } from 'fs';
import { resolve } from 'path';
import { tenantPath } from './tenant';

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
  twitchClientId?: string;
  twitchClientSecret?: string;
  broadcasterTokenExpiry?: number;
  botTokenExpiry?: number;
  communityBotTokenExpiry?: number;
  loginTokenExpiry?: number;
  lastUpdated?: string;
}

function tokensFilePath(tenantId?: string): string {
  if (tenantId) {
    return tenantPath(tenantId, 'tokens/twitch-tokens.json');
  }
  return resolve(process.cwd(), 'tokens', 'twitch-tokens.json');
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

export async function ensureValidToken(
  clientId: string,
  clientSecret: string,
  tokenType: 'broadcaster' | 'bot' | 'community-bot',
  tokens: StoredTokens,
  tenantId?: string
): Promise<string> {
  const tokenKey = tokenType === 'broadcaster' ? 'broadcasterToken' : tokenType === 'bot' ? 'botToken' : 'communityBotToken';
  const refreshTokenKey = tokenType === 'broadcaster' ? 'broadcasterRefreshToken' : tokenType === 'bot' ? 'botRefreshToken' : 'communityBotRefreshToken';
  const expiryKey = tokenType === 'broadcaster' ? 'broadcasterTokenExpiry' : tokenType === 'bot' ? 'botTokenExpiry' : 'communityBotTokenExpiry';

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

  if (needsRefresh) {
    console.log(`[Token] ${tokenType} token is invalid or expired, refreshing...`);
    const newTokenData = await refreshAccessToken(refreshToken, clientId, clientSecret);
    const newExpiry = now + (newTokenData.expires_in - 60) * 1000;

    const updatedTokens: StoredTokens = {
      ...tokens,
      [tokenKey]: newTokenData.access_token,
      [refreshTokenKey]: newTokenData.refresh_token,
      [expiryKey]: newExpiry,
      lastUpdated: new Date().toISOString(),
    };

    await storeTokens(updatedTokens, tenantId);
    console.log(`[Token] Successfully refreshed ${tokenType} token`);
    accessToken = newTokenData.access_token;
  }

  return accessToken;
}
