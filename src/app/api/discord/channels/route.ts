import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile } from 'fs/promises';
import { resolve } from 'path';
import { writeUserConfig } from '@/lib/user-config';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const SETTINGS_FILE = resolve(process.cwd(), 'tokens', 'discord-channels.json');

const discordChannelsSchema = z.object({
  logChannelId: z.string().trim().max(64).optional().default(''),
  aiChatChannelId: z.string().trim().max(64).optional().default(''),
  shoutoutChannelId: z.string().trim().max(64).optional().default(''),
});

export async function GET(request: NextRequest) {
  try {
    const data = await readFile(SETTINGS_FILE, 'utf-8');
    const parsed = discordChannelsSchema.safeParse(JSON.parse(data));
    if (parsed.success) {
      return apiOk(parsed.data as unknown as Record<string, unknown>);
    }
    return apiOk({
      logChannelId: '',
      aiChatChannelId: '',
      shoutoutChannelId: '',
    });
  } catch (error) {
    return apiOk({
      logChannelId: '',
      aiChatChannelId: '',
      shoutoutChannelId: ''
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = discordChannelsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const settings = parsed.data;
    await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));

    // Keep user-config in sync for callers that read env/config directly.
    await writeUserConfig({
      NEXT_PUBLIC_DISCORD_LOG_CHANNEL_ID: settings?.logChannelId,
      NEXT_PUBLIC_DISCORD_AI_CHAT_CHANNEL_ID: settings?.aiChatChannelId,
      NEXT_PUBLIC_DISCORD_SHOUTOUT_CHANNEL_ID: settings?.shoutoutChannelId,
    });
    return apiOk({ success: true });
  } catch (error) {
    return apiError('Failed to save settings', { status: 500, code: 'INTERNAL_ERROR' });
  }
}