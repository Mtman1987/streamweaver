import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { sendDiscordMessage } from '@/services/discord';
import { z } from 'zod';

const sendDiscordMessageSchema = z.object({
  channelId: z.string().trim().min(1, 'Channel ID required').max(64, 'Channel ID invalid'),
  message: z.string().trim().min(1, 'Message required').max(2000, 'Message too long'),
  username: z.string().trim().min(1).max(128).optional(),
  avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }

    const parsed = sendDiscordMessageSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { channelId, message, username, avatarUrl } = parsed.data;
    await sendDiscordMessage(channelId, message, username, avatarUrl || undefined);
    return apiOk({ success: true });
  } catch (error) {
    console.error('[Discord Send Message] Failed:', error);
    return apiError('Failed to send Discord message', { status: 500, code: 'DISCORD_SEND_FAILED' });
  }
}
