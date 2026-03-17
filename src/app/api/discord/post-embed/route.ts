import { NextRequest, NextResponse } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const discordPostEmbedSchema = z.object({
  channelId: z.string().trim().min(1, 'Channel ID required').max(64, 'Channel ID invalid'),
  embed: z.record(z.unknown()),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = discordPostEmbedSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Channel ID and embed data are required', { status: 400, code: 'INVALID_BODY' });
    }

    const { channelId, embed } = parsed.data;

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return apiError('Discord bot token not configured', { status: 500, code: 'MISSING_CONFIG' });
    }

    // Send embed message
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [embed] })
    });

    if (!response.ok) {
      return apiError('Discord API error', { status: 502, code: 'UPSTREAM_ERROR' });
    }

    return apiOk({ success: true });
  } catch (error) {
    console.error('Error posting Discord embed:', error);
    return apiError('Failed to post embed', { status: 500, code: 'INTERNAL_ERROR' });
  }
}