import { promises as fs } from 'fs';
import { resolve } from 'path';
import { tenantPath } from './tenant';

export interface StoredTokens {
    broadcasterToken?: string;
    broadcasterUsername?: string;
    broadcasterRefreshToken?: string;
    broadcasterTokenExpiry?: number;
    botToken?: string;
    botUsername?: string;
    botRefreshToken?: string;
    botTokenExpiry?: number;
    communityBotToken?: string;
    communityBotUsername?: string;
    communityBotRefreshToken?: string;
    communityBotTokenExpiry?: number;
    loginToken?: string;
    loginUsername?: string;
    loginRefreshToken?: string;
    loginTokenExpiry?: number;
    twitchClientId?: string;
    twitchClientSecret?: string;
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

export async function saveTokens(tokens: StoredTokens, tenantId?: string): Promise<void> {
    const filePath = tokensFilePath(tenantId);
    await fs.mkdir(resolve(filePath, '..'), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(tokens, null, 2));
}

export async function ensureValidToken(token: string): Promise<string> {
    if (!token || token.length < 10) {
        throw new Error('Invalid token');
    }
    return token;
}
