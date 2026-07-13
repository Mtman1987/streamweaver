'use server';

import * as local from './discord-local';
import { sendWebhookMessage } from './discord-webhooks';

export async function sendDiscordMessage(channelId: string, message: string, username?: string, avatarUrl?: string): Promise<void> {
    try {
        await sendWebhookMessage(channelId, message, username, avatarUrl);
    } catch (error) {
        console.warn('[Discord] Webhook send failed, falling back to bot message:', error);
        await local.sendDiscordMessage(channelId, message);
    }
}

export async function sendDiscordEmbed(
    channelId: string,
    options: { content?: string; embeds: Record<string, unknown>[]; components?: Record<string, unknown>[] },
): Promise<Record<string, unknown>> {
    return local.sendDiscordEmbed(channelId, options);
}
export async function getDiscordUser(
    userId: string
): Promise<{ username: string; avatarUrl: string } | null> {
    return local.getDiscordUser(userId);
}

export async function uploadFileToDiscord(
    channelId: string,
    fileContent: string,
    fileName: string,
    messageContent?: string
): Promise<{ success: boolean; messageUrl: string; data?: unknown }> {
    return local.uploadFileToDiscord(channelId, fileContent, fileName, messageContent);
}

export async function uploadBinaryFileToDiscord(
    channelId: string,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    payload?: { content?: string; embeds?: Record<string, unknown>[] },
): Promise<Record<string, unknown>> {
    return local.uploadBinaryFileToDiscord(channelId, fileBuffer, fileName, mimeType, payload);
}

export async function getChannelMessages(channelId: string, limit: number = 50) {
    return local.getChannelMessages(channelId, limit);
}

export async function getDiscordMessage(channelId: string, messageId: string) {
    return local.getDiscordMessage(channelId, messageId);
}

export async function editDiscordMessage(channelId: string, messageId: string, newContent: string): Promise<void> {
    await local.editDiscordMessage(channelId, messageId, newContent);
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
    await local.deleteMessage(channelId, messageId);
}
