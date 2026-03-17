import { NextRequest, NextResponse } from 'next/server';
import { sendDiscordMessage } from '@/services/discord';
import { readUserConfig } from '@/lib/user-config';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const chatLogSchema = z.object({
  username: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(2000),
  timestamp: z.string().trim().max(64).optional(),
  platform: z.string().trim().max(32).optional().default('twitch'),
  userId: z.string().trim().max(128).optional(),
  badges: z.array(z.string()).optional(),
  color: z.string().trim().max(32).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const userConfig = await readUserConfig();

    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== process.env.BOT_SECRET_KEY) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }

    const parsed = chatLogSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Username and message are required', { status: 400, code: 'INVALID_BODY' });
    }

    const { username, message, platform } = parsed.data;

    // Log to Discord
    const discordChannelId =
      userConfig.NEXT_PUBLIC_DISCORD_LOG_CHANNEL_ID ||
      process.env.NEXT_PUBLIC_DISCORD_LOG_CHANNEL_ID;
    if (!discordChannelId) {
      return apiError('Discord log channel not configured', { status: 500, code: 'MISSING_CONFIG' });
    }

    try {
      const discordMessage = `[${(platform || 'twitch').charAt(0).toUpperCase() + (platform || 'twitch').slice(1)}] ${username}: ${message}`;
      await sendDiscordMessage(discordChannelId, discordMessage);
      
      return apiOk({ success: true });
    } catch (error) {
      console.error('Failed to log to Discord:', error);
      return apiError('Failed to log message', { status: 500, code: 'DISCORD_LOG_FAILED' });
    }

  } catch (error) {
    console.error('Error logging chat message:', error);
    return apiError('Internal server error', { status: 500, code: 'INTERNAL_ERROR' });
  }
}