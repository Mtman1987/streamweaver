import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { hasInternalServiceAccess } from '@/lib/internal-service-auth';
import { readPrivateChatSettings } from '@/lib/private-chat-settings-store';
import { editDiscordMessage, getDiscordMessage } from '@/services/discord-local';
import {
  applyPrivateDmGif,
  attachPrivateDmControls,
  resolvePrivateDmMediaUrl,
  resolvePrivateDmTenantId,
} from '@/services/private-dm-controls';

export const dynamic = 'force-dynamic';

type FinalizePrivateDmBody = {
  channelId?: unknown;
  messageId?: unknown;
};

function snowflake(value: unknown): string {
  const normalized = String(value || '').trim();
  return /^\d{15,22}$/.test(normalized) ? normalized : '';
}

/**
 * One post-send boundary for every app that delivers a Discord DM embed.
 * The sending app keeps ownership of its content and transport; StreamWeaver
 * owns the saved presentation settings and signed private controls.
 */
export async function POST(request: NextRequest) {
  if (!hasInternalServiceAccess(request)) {
    return apiError('Unauthorized private DM finalizer request.', {
      status: 401,
      code: 'UNAUTHORIZED',
    });
  }

  const body = await request.json().catch(() => null) as FinalizePrivateDmBody | null;
  const channelId = snowflake(body?.channelId);
  const messageId = snowflake(body?.messageId);
  if (!channelId || !messageId) {
    return apiError('Valid Discord channelId and messageId are required.', {
      status: 400,
      code: 'INVALID_DISCORD_MESSAGE',
    });
  }

  const tenantId = await resolvePrivateDmTenantId(channelId);
  if (!tenantId) {
    return apiError('The private Discord channel is not connected to a StreamWeaver account.', {
      status: 404,
      code: 'PRIVATE_CHANNEL_NOT_FOUND',
    });
  }

  const [settings, message] = await Promise.all([
    readPrivateChatSettings(tenantId),
    getDiscordMessage(channelId, messageId),
  ]);
  const currentEmbeds = Array.isArray((message as any)?.embeds)
    ? (message as any).embeds as Record<string, unknown>[]
    : [];
  if (!currentEmbeds.length) {
    return apiOk({
      success: true,
      finalized: false,
      skipped: 'message-has-no-embeds',
      tenantId,
    });
  }

  const mediaUrl = resolvePrivateDmMediaUrl(tenantId);
  let embeds = applyPrivateDmGif(currentEmbeds, mediaUrl, settings.gifEnabled);
  embeds = attachPrivateDmControls(embeds, {
    channelId,
    messageId,
    gifEnabled: settings.gifEnabled,
    ttsEnabled: settings.ttsEnabled,
    adultMode: settings.adultMode,
  });
  await editDiscordMessage(channelId, messageId, { embeds });

  return apiOk({
    success: true,
    finalized: true,
    tenantId,
    gifEnabled: settings.gifEnabled,
    ttsEnabled: settings.ttsEnabled,
    adultMode: settings.adultMode,
  });
}
