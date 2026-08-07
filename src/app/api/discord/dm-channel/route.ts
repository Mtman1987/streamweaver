import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readDiscordConfig, updateDiscordConfig } from '@/lib/discord-config';
import { createDiscordDmChannel, sendDiscordMessage } from '@/services/discord-local';
import { getSpmtDiscordIdentity } from '@/lib/spmt-userinfo';
import { z } from 'zod';

const dmChannelSchema = z.object({
  discordUserId: z.string().trim().max(64).optional(),
});

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

    const settings = await readDiscordConfig(session.tenantId);
    const spmtIdentity = !parsed.data.discordUserId && !settings.discordUserId
      ? await getSpmtDiscordIdentity(request).catch(() => null)
      : null;
    const discordUserId = String(
      parsed.data.discordUserId || settings.discordUserId || spmtIdentity?.discordUserId || '',
    ).trim();
    if (!discordUserId || !/^\d{10,32}$/.test(discordUserId)) {
      return apiError('Connect a Discord user account first.', {
        status: 400,
        code: 'DISCORD_USER_NOT_LINKED',
      });
    }

    const dm = await createDiscordDmChannel(discordUserId);
    const nextSettings = {
      discordUserId,
      ...(spmtIdentity?.discordUsername ? { discordUsername: spmtIdentity.discordUsername } : {}),
      dmChannelId: dm.id,
      dmEnabled: true,
      dmChannelUpdatedAt: new Date().toISOString(),
    };
    await updateDiscordConfig(nextSettings as any, session.tenantId);

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
