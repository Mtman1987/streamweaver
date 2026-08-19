import { NextRequest, NextResponse } from 'next/server';
import { isUserConfigComplete, readUserConfig, writeUserConfig } from '@/lib/user-config';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { normalizeTtsProvider, normalizeTtsVoice } from '@/lib/tts-voices';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const userConfigPatchSchema = z.record(z.unknown());

const ALLOWED_KEYS = new Set([
  // Twitch (user-specific)
  'TWITCH_BROADCASTER_USERNAME',
  'TWITCH_BROADCASTER_ID',
  'NEXT_PUBLIC_TWITCH_BROADCASTER_USERNAME',
  'NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID',

  // Discord (user-specific)
  'NEXT_PUBLIC_DISCORD_AI_CHAT_CHANNEL_ID',
  'NEXT_PUBLIC_DISCORD_SHOUTOUT_CHANNEL_ID',
  'NEXT_PUBLIC_DISCORD_SHARE_CHANNEL_ID',
  'NEXT_PUBLIC_DISCORD_METRICS_CHANNEL_ID',
  'DISCORD_RAID_TRAIN_CHANNEL_ID',

  // AI Configuration (user-specific)
  'AI_PROVIDER', // 'gemini' | 'edenai' | 'openai'
  'AI_MODEL',
  'AI_PERSONALITY_NAME', // replaces hardcoded 'Commander'
  'AI_BOT_NAME', // replaces hardcoded 'Athena'
  'AI_BOT_ALIASES', // trigger aliases (comma-separated)
  'AI_BOT_PERSONALITY',
  'AI_BOT_INTERESTS',
  'GEMINI_API_KEY',
  'EDENAI_API_KEY',
  'DEEPGRAM_API_KEY',
  'OPENAI_API_KEY',

  // TTS Configuration (user-specific)
  'TTS_PROVIDER', // 'piper' | 'edenai' | 'openai' (legacy routed values auto-normalize)
  'TTS_VOICE',
  'PRIVATE_DM_GIF_URL',
  'PUBLIC_DISCORD_GIF_URL',
  'AI_BOT_AVATAR_URL',
  'AI_BOT_IDLE_AVATAR_URL',
  'AI_BOT_TALKING_AVATAR_URL',

  // Raid train tuning (user-specific)
  'EMERGENCY_SLOTS_LOOKAHEAD_HOURS',
  'RAID_TRAIN_SLOT_COST',
  'EMERGENCY_SLOT_COST',
]);

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const config = await readUserConfig(session?.tenantId);
  const complete = await isUserConfigComplete(session?.tenantId);
  return apiOk({ config, complete });
}

export async function POST(request: NextRequest) {
  const parsed = userConfigPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Invalid JSON body', { status: 400, code: 'INVALID_BODY' });
  }

  const body = parsed.data;
  const session = getTenantFromRequest(request);
  const requestedProvider = normalizeTtsProvider(body.TTS_PROVIDER);

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (key === 'TTS_PROVIDER') {
      patch[key] = requestedProvider;
      continue;
    }
    if (key === 'TTS_VOICE') {
      patch[key] = normalizeTtsVoice(String(value), requestedProvider);
      continue;
    }
    patch[key] = value;
  }

  const config = await writeUserConfig(patch, session?.tenantId);
  const complete = Boolean(config.TWITCH_BROADCASTER_USERNAME && config.AI_PROVIDER);

  return apiOk({ config, complete });
}
