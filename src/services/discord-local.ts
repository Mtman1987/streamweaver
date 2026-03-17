import { DiscordMessage } from '../types/game-types';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

async function discordRequest(endpoint: string, options: RequestInit = {}) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        throw new Error('DISCORD_BOT_TOKEN is not configured');
    }

    const response = await fetch(`${DISCORD_API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bot ${token}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Discord API error: ${response.status} ${error}`);
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

export async function sendDiscordMessage(channelId: string, message: string): Promise<void> {
    await discordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: message }),
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

export async function editDiscordMessage(channelId: string, messageId: string, newContent: string): Promise<void> {
    await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: newContent }),
    });
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
    await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
        method: 'DELETE',
    });
}
