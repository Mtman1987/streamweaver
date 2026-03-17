import { NextRequest } from 'next/server';
import { readUserConfig, writeUserConfig } from '@/lib/user-config';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const KEY_MAPPING: Record<string, string> = {
  edenaiApiKey: 'EDENAI_API_KEY',
  geminiApiKey: 'GEMINI_API_KEY',
  openaiApiKey: 'OPENAI_API_KEY',
  inworldApiKey: 'INWORLD_API_KEY',
  discordLogChannelId: 'NEXT_PUBLIC_DISCORD_LOG_CHANNEL_ID',
  discordAiChatChannelId: 'NEXT_PUBLIC_DISCORD_AI_CHAT_CHANNEL_ID',
  discordWebhookUrl: 'DISCORD_WEBHOOK_URL',
  defaultTtsVoice: 'TTS_VOICE',
};

const configUpdateSchema = z.record(z.union([z.string(), z.number(), z.boolean()])).default({});

export async function GET(request: NextRequest) {
  try {
    const config = await readUserConfig();
    
    // Map back to camelCase for UI
    const mapped: any = {};
    for (const [uiKey, envKey] of Object.entries(KEY_MAPPING)) {
      if (config[envKey]) {
        const isSecret = /API_KEY|TOKEN|PASSWORD|SECRET/.test(envKey);
        const value = String(config[envKey]);
        mapped[uiKey] = isSecret && value ? `${'*'.repeat(Math.min(8, Math.max(4, value.length - 4)))}${value.slice(-4)}` : value;
      }
    }
    
    return apiOk(mapped);
  } catch (error) {
    console.error('Failed to get config:', error);
    return apiError('Failed to load configuration', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = configUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const updates = parsed.data;
    
    // Map camelCase to ENV_CASE
    const envUpdates: Record<string, string> = {};
    for (const [uiKey, value] of Object.entries(updates)) {
      const envKey = KEY_MAPPING[uiKey];
      if (envKey && value != null && String(value).trim() !== '') {
        envUpdates[envKey] = String(value);
      }
    }
    
    await writeUserConfig(envUpdates);
    return apiOk({ success: true });
  } catch (error) {
    console.error('Failed to update config:', error);
    return apiError('Failed to save configuration', { status: 500, code: 'INTERNAL_ERROR' });
  }
}