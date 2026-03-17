import { promises as fs } from 'fs';
import { resolve } from 'path';

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

/**
 * Gets stored tokens from local file (server-only)
 */
export async function getStoredTokens(): Promise<StoredTokens | null> {
  try {
    const tokensFile = resolve(process.cwd(), 'tokens', 'twitch-tokens.json');
    const data = await fs.readFile(tokensFile, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

/**
 * Stores tokens to local file (server-only)
 */
export async function storeTokens(tokens: StoredTokens): Promise<void> {
  try {
    const tokensDir = resolve(process.cwd(), 'tokens');
    const tokensFile = resolve(tokensDir, 'twitch-tokens.json');

    try {
      await fs.access(tokensDir);
    } catch {
      await fs.mkdir(tokensDir, { recursive: true });
    }

    await fs.writeFile(tokensFile, JSON.stringify(tokens, null, 2));
  } catch (error) {
    console.error('Error storing tokens:', error);
    throw error;
  }
}

/**
 * Refreshes an access token using the refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<TokenData> {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
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

  const tokenData: TokenData = await response.json();
  return tokenData;
}

/**
 * Validates an access token with Twitch.
 */
export async function validateAccessToken(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    return response.ok;
  } catch (error) {
    console.error('Error validating token:', error);
    return false;
  }
}

/**
 * Ensures a valid access token, refreshing if necessary.
 */
export async function ensureValidToken(
  clientId: string,
  clientSecret: string,
  tokenType: 'broadcaster' | 'bot' | 'community-bot',
  tokens: StoredTokens
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

  // Check if token is expired or about to expire (within 5 minutes)
  const now = Date.now();
  const isExpired = !tokenExpiry || tokenExpiry - now < 5 * 60 * 1000;

  let needsRefresh = isExpired;

  if (!needsRefresh) {
    // Validate the current token if expiry check isn't sufficient
    const isValid = await validateAccessToken(accessToken);
    needsRefresh = !isValid;
  }

  if (needsRefresh) {
    console.log(`[Token] ${tokenType} token is invalid or expired, refreshing...`);

    try {
      const newTokenData = await refreshAccessToken(refreshToken, clientId, clientSecret);

      // Calculate new expiry time
      const newExpiry = now + (newTokenData.expires_in - 60) * 1000; // Buffer of 1 minute

      // Update the tokens
      const updatedTokens: StoredTokens = {
        ...tokens,
        [tokenKey]: newTokenData.access_token,
        [refreshTokenKey]: newTokenData.refresh_token,
        [expiryKey]: newExpiry,
        lastUpdated: new Date().toISOString()
      };

      await storeTokens(updatedTokens);

      console.log(`[Token] Successfully refreshed ${tokenType} token`);
      accessToken = newTokenData.access_token;
    } catch (error) {
      console.error(`[Token] Failed to refresh ${tokenType} token:`, error);
      throw error;
    }
  }

  return accessToken;
}