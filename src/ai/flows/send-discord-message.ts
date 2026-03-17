'use server';

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
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3100'}/api/discord/send-message`, {
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