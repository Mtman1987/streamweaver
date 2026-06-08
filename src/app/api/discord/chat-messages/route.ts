import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getChannelMessages } from '@/services/discord';

const chatMessagesSchema = z.object({
  channelId: z.string().trim().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }

    const parsed = chatMessagesSchema.safeParse({
      channelId: request.nextUrl.searchParams.get('channelId'),
      limit: request.nextUrl.searchParams.get('limit') || undefined,
    });
    if (!parsed.success) {
      return apiError('Invalid channel request', { status: 400, code: 'INVALID_QUERY' });
    }

    const messages = await getChannelMessages(parsed.data.channelId, parsed.data.limit);
    return apiOk({ messages: Array.isArray(messages) ? messages : [] });
  } catch (error) {
    console.error('[Discord Chat Messages] Failed:', error);
    return apiError('Failed to fetch Discord messages', { status: 500, code: 'DISCORD_MESSAGES_FAILED' });
  }
}
