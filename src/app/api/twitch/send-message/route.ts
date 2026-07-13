import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { publishSpmtEvent } from '@/lib/spmt-client';

const twitchSendSchema = z.object({
  message: z.string().trim().min(1, 'Message is required').max(500, 'Message too long'),
  as: z.enum(['bot', 'broadcaster']).optional().default('broadcaster'),
  targetChannel: z.string().trim().max(128).optional(),
  tenantId: z.string().trim().max(128).optional(),
  bridgeToDiscord: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const parsed = twitchSendSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const wsPort = process.env.WS_PORT || '8090';
    const response = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...parsed.data,
        tenantId: parsed.data.tenantId || session?.tenantId,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return apiError(body?.error || 'Failed to send Twitch message', { status: response.status, code: 'SEND_FAILED' });
    }

    const tenantId = parsed.data.tenantId || session?.tenantId;
    void publishSpmtEvent({
      type: 'chat.twitch.message_sent',
      visibility: 'creator',
      actor: tenantId ? { userId: tenantId, username: tenantId, displayName: tenantId } : undefined,
      payload: {
        summary: `StreamWeaver sent a Twitch message as ${parsed.data.as}.`,
        tenantId: tenantId || 'global',
        targetChannel: parsed.data.targetChannel || null,
        as: parsed.data.as,
        bridgeToDiscord: Boolean(parsed.data.bridgeToDiscord),
        message: parsed.data.message,
      },
    });

    return apiOk({ success: true });
  } catch (error) {
    console.error('[Twitch Send Message API] Failed:', error);
    return apiError('Failed to send Twitch message', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
