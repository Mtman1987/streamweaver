import { promises as fs } from 'fs';
import { resolve } from 'path';

const TOKENS_FILE = resolve(process.cwd(), 'tokens', 'twitch-tokens.json');

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

export async function getStoredTokens(): Promise<StoredTokens | null> {
    try {
        const data = await fs.readFile(TOKENS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
    try {
        await fs.mkdir(resolve(process.cwd(), 'tokens'), { recursive: true });
        await fs.writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2));
    } catch (error) {
        console.error('Failed to save tokens:', error);
        throw error;
    }
}

export async function ensureValidToken(token: string): Promise<string> {
    // Basic token validation - in a real app you'd validate with Twitch API
    if (!token || token.length < 10) {
        throw new Error('Invalid token');
    }
    return token;
}