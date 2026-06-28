import { DiscordMessage } from '../types/game-types';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_API_MIN_INTERVAL_MS = Math.max(0, Number(process.env.DISCORD_API_MIN_INTERVAL_MS || 350));
const DISCORD_API_MAX_RETRY_MS = Math.max(1000, Number(process.env.DISCORD_API_MAX_RETRY_MS || 15000));

let discordRequestQueue: Promise<unknown> = Promise.resolve();
let lastDiscordRequestAt = 0;

export class DiscordApiError extends Error {
    status: number;
    body: string;
    retryAfterMs?: number;

    constructor(status: number, body: string, retryAfterMs?: number) {
        super(`Discord API ${status}: ${body}`);
        this.name = 'DiscordApiError';
        this.status = status;
        this.body = body;
        this.retryAfterMs = retryAfterMs;
    }
}

export function isDiscordApiError(error: unknown): error is DiscordApiError {
    return error instanceof DiscordApiError;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function throttleDiscordRequest() {
    const elapsed = Date.now() - lastDiscordRequestAt;
    const waitMs = DISCORD_API_MIN_INTERVAL_MS - elapsed;
    if (waitMs > 0) {
        await delay(waitMs);
    }
    lastDiscordRequestAt = Date.now();
}

async function enqueueDiscordRequest<T>(operation: () => Promise<T>): Promise<T> {
    const run = discordRequestQueue.then(operation, operation);
    discordRequestQueue = run.catch(() => undefined);
    return run;
}

function getRetryAfterMs(response: Response, body: string): number | undefined {
    const header = response.headers.get('retry-after');
    const headerSeconds = header ? Number(header) : NaN;
    if (Number.isFinite(headerSeconds)) {
        return Math.max(0, Math.ceil(headerSeconds * 1000));
    }

    try {
        const parsed = JSON.parse(body);
        const retryAfterSeconds = Number(parsed?.retry_after);
        if (Number.isFinite(retryAfterSeconds)) {
            return Math.max(0, Math.ceil(retryAfterSeconds * 1000));
        }
    } catch {
        // Body is not always JSON.
    }

    return undefined;
}

async function performDiscordRequest(endpoint: string, options: RequestInit = {}) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        throw new Error('DISCORD_BOT_TOKEN is not configured');
    }

    await throttleDiscordRequest();

    const response = await fetch(`${DISCORD_API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bot ${token}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        const body = await response.text();
        const retryAfterMs = getRetryAfterMs(response, body);
        throw new DiscordApiError(response.status, body, retryAfterMs);
    }

    // Some Discord endpoints (e.g. DELETE) return 204 with no body.
    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function discordRequest(endpoint: string, options: RequestInit = {}) {
    return enqueueDiscordRequest(async () => {
        try {
            return await performDiscordRequest(endpoint, options);
        } catch (error) {
            if (!isDiscordApiError(error) || error.status !== 429) {
                throw error;
            }

            const waitMs = Math.min(error.retryAfterMs ?? 2500, DISCORD_API_MAX_RETRY_MS);
            console.warn(`[Discord] API rate limited; retrying ${endpoint} after ${waitMs}ms.`);
            await delay(waitMs);
            return performDiscordRequest(endpoint, options);
        }
    });
}

export async function sendDiscordMessage(channelId: string, message: string): Promise<void> {
    await discordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: message }),
    });
}

export async function createDiscordDmChannel(recipientId: string): Promise<{ id: string; raw: unknown }> {
    const data = await discordRequest('/users/@me/channels', {
        method: 'POST',
        body: JSON.stringify({ recipient_id: recipientId }),
    }) as any;
    const id = String(data?.id || '').trim();
    if (!id) {
        throw new Error('Discord did not return a DM channel id');
    }
    return { id, raw: data };
}

export async function sendDiscordEmbed(channelId: string, options: { content?: string; embeds: Record<string, unknown>[]; components?: Record<string, unknown>[] }): Promise<Record<string, unknown>> {
    return await discordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify(options),
    });
}

export async function getDiscordUser(userId: string): Promise<{ username: string; avatarUrl: string } | null> {
    try {
        const user = await discordRequest(`/users/${userId}`);
        return {
            username: user.username,
            avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png` : '',
        };
    } catch {
        return null;
    }
}

export async function uploadFileToDiscord(
    channelId: string,
    fileContent: string,
    fileName: string,
    messageContent?: string
): Promise<{ success: boolean; messageUrl: string; data?: unknown }> {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        throw new Error('DISCORD_BOT_TOKEN is not configured');
    }

    const formData = new FormData();
    const blob = new Blob([fileContent], { type: 'text/plain' });
    formData.append('files[0]', blob, fileName);
    
    if (messageContent) {
        formData.append('payload_json', JSON.stringify({ content: messageContent }));
    }

    const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bot ${token}`,
        },
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Failed to upload file: ${response.status}`);
    }

    const data = await response.json();
    return {
        success: true,
        messageUrl: `https://discord.com/channels/${data.guild_id}/${channelId}/${data.id}`,
        data,
    };
}

export async function getChannelMessages(channelId: string, limit: number = 50) {
    return await discordRequest(`/channels/${channelId}/messages?limit=${limit}`);
}

export async function getDiscordMessage(channelId: string, messageId: string): Promise<DiscordMessage> {
    return await discordRequest(`/channels/${channelId}/messages/${messageId}`);
}

export async function editDiscordMessage(
    channelId: string,
    messageId: string,
    payload: string | { content?: string; embeds?: Record<string, unknown>[]; components?: Record<string, unknown>[] },
): Promise<void> {
    const body = typeof payload === 'string' ? { content: payload } : payload;
    await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export async function uploadBinaryFileToDiscord(
    channelId: string,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    payload?: { content?: string; embeds?: Record<string, unknown>[] },
): Promise<Record<string, unknown>> {
    return enqueueDiscordRequest(async () => {
        const token = process.env.DISCORD_BOT_TOKEN;
        if (!token) throw new Error('DISCORD_BOT_TOKEN is not configured');

        await throttleDiscordRequest();

        const formData = new FormData();
        const bytes = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength) as unknown as BlobPart;
        const blob = new Blob([bytes], { type: mimeType });
        formData.append('files[0]', blob, fileName);
        if (payload) {
            formData.append('payload_json', JSON.stringify(payload));
        }

        const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bot ${token}` },
            body: formData,
        });

        if (!response.ok) {
            const text = await response.text();
            throw new DiscordApiError(response.status, text);
        }
        return await response.json();
    });
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
    await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
        method: 'DELETE',
    });
}
