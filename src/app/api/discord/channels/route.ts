import { NextRequest } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiError, apiOk } from '@/lib/api-response';
import { publicDiscordConfig, readDiscordConfig, updateDiscordConfig } from '@/lib/discord-config';
import { z } from 'zod';

const discordChannelsSchema = z.object({
  guildId: z.string().trim().max(64).optional().default(''),
  logChannelId: z.string().trim().max(64).optional().default(''),
  aiChatChannelId: z.string().trim().max(64).optional().default(''),
  shoutoutChannelId: z.string().trim().max(64).optional().default(''),
  dmChannelId: z.string().trim().max(64).optional().default(''),
  dmEnabled: z.boolean().optional(),
  discordBridgeEnabled: z.boolean().optional(),
  discordUserId: z.string().trim().max(64).optional().default(''),
  discordUsername: z.string().trim().max(128).optional().default(''),
  tenantId: z.string().trim().max(128).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
    const tenantId = session.tenantId;
    return apiOk(publicDiscordConfig(await readDiscordConfig(tenantId)));
  } catch {
    return apiOk({
      guildId: '',
      logChannelId: '',
      aiChatChannelId: '',
      shoutoutChannelId: '',
      dmChannelId: '',
      discordUserId: '',
      discordUsername: '',
      dmEnabled: false,
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
    if (!session?.tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
    const tenantId = session.tenantId;

    const { tenantId: _tenantId, ...channelSettings } = parsed.data;
    await updateDiscordConfig(channelSettings, tenantId);

    return apiOk({ success: true });
  } catch (error) {
    console.error('[Discord Channels] Save failed:', error);
    return apiError('Failed to save settings', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
