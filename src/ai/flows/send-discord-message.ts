'use server';

import { getInternalAppUrl } from '@/lib/runtime-origin';

export interface SendDiscordMessageInput {
  channelId: string;
  message: string;
}

export interface SendDiscordMessageOutput {
  success: boolean;
  error?: string;
}

export async function sendDiscordMessage(input: SendDiscordMessageInput): Promise<SendDiscordMessageOutput> {
  try {
    const response = await fetch(`${getInternalAppUrl()}/api/discord/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: input.channelId,
        message: input.message
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to send Discord message:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}