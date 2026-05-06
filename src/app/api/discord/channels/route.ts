import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { tenantPath } from '@/lib/tenant';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const discordChannelsSchema = z.object({
  guildId: z.string().trim().max(64).optional().default(''),
  logChannelId: z.string().trim().max(64).optional().default(''),
  aiChatChannelId: z.string().trim().max(64).optional().default(''),
  shoutoutChannelId: z.string().trim().max(64).optional().default(''),
  discordBridgeEnabled: z.boolean().optional(),
});

function getFilePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'tokens/discord-channels.json');
  return resolve(process.cwd(), 'tokens', 'discord-channels.json');
}

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const filePath = getFilePath(session?.tenantId);
    const data = await fs.readFile(filePath, 'utf-8').catch(() => '{}');
    const parsed = JSON.parse(data);
    return apiOk({
      guildId: parsed.guildId || '',
      logChannelId: parsed.logChannelId || '',
      aiChatChannelId: parsed.aiChatChannelId || '',
      shoutoutChannelId: parsed.shoutoutChannelId || '',
      discordBridgeEnabled: parsed.discordBridgeEnabled !== false,
    });
  } catch {
    return apiOk({
      guildId: '',
      logChannelId: '',
      aiChatChannelId: '',
      shoutoutChannelId: '',
      discordBridgeEnabled: true,
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = discordChannelsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const session = getTenantFromRequest(request);
    const tenantId = session?.tenantId;
    const filePath = getFilePath(tenantId);

    // Merge with existing (don't overwrite fields not sent)
    let existing: Record<string, any> = {};
    try { existing = JSON.parse(await fs.readFile(filePath, 'utf-8')); } catch {}

    const settings = { ...existing, ...parsed.data };

    await fs.mkdir(resolve(filePath, '..'), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(settings, null, 2));

    return apiOk({ success: true });
  } catch (error) {
    console.error('[Discord Channels] Save failed:', error);
    return apiError('Failed to save settings', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
