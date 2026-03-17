'use server';

export interface SendTwitchMessageInput {
  message: string;
  as: 'broadcaster' | 'bot';
}

export interface SendTwitchMessageOutput {
  success: boolean;
  error?: string;
}

export async function sendTwitchMessage(input: SendTwitchMessageInput): Promise<SendTwitchMessageOutput> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3100'}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: input.message,
        as: input.as
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to send Twitch message:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}