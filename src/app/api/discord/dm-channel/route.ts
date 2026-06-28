import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { apiError, apiOk } from '@/lib/api-response';
import { tenantPath } from '@/lib/tenant';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { createDiscordDmChannel, sendDiscordMessage } from '@/services/discord-local';
import { z } from 'zod';

const dmChannelSchema = z.object({
  discordUserId: z.string().trim().max(64).optional(),
});

function getChannelsPath(tenantId: string): string {
  return tenantPath(tenantId, 'tokens/discord-channels.json');
}

async function readSettings(tenantId: string): Promise<Record<string, any>> {
  try {
    return JSON.parse(await fs.readFile(getChannelsPath(tenantId), 'utf-8'));
  } catch {
    return {};
  }
}

async function writeSettings(tenantId: string, settings: Record<string, any>): Promise<void> {
  const filePath = getChannelsPath(tenantId);
  await fs.mkdir(resolve(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }

    const parsed = dmChannelSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const settings = await readSettings(session.tenantId);
    const discordUserId = String(parsed.data.discordUserId || settings.discordUserId || '').trim();
    if (!discordUserId || !/^\d{10,32}$/.test(discordUserId)) {
      return apiError('Connect a Discord user account first.', {
        status: 400,
        code: 'DISCORD_USER_NOT_LINKED',
      });
    }

    const dm = await createDiscordDmChannel(discordUserId);
    const nextSettings = {
      ...settings,
      discordUserId,
      dmChannelId: dm.id,
      dmEnabled: true,
      dmChannelUpdatedAt: new Date().toISOString(),
    };
    await writeSettings(session.tenantId, nextSettings);

    await sendDiscordMessage(
      dm.id,
      'StreamWeaver private DM setup is connected. You can use !img here and generated images will be saved to your private image library.',
    ).catch((error) => {
      console.warn('[Discord DM Channel] Setup DM send failed:', error);
    });

    return apiOk({
      success: true,
      dmChannelId: dm.id,
      discordUserId,
    });
  } catch (error) {
    console.error('[Discord DM Channel] Registration failed:', error);
    return apiError('Failed to create Discord DM channel', {
      status: 500,
      code: 'DISCORD_DM_CHANNEL_FAILED',
    });
  }
}
