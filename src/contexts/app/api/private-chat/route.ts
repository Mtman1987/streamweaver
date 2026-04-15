import { NextRequest } from 'next/server';
import { readPrivateChatMessages, appendPrivateChatMessages, type PrivateChatMessage } from '@/lib/private-chat-store';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const privateChatMessageSchema = z.object({
  type: z.enum(['user', 'ai']),
  username: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(4000),
  timestamp: z.string().trim().min(1).max(64),
});

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const messages = await readPrivateChatMessages(undefined, session?.tenantId);
    return apiOk({ messages });
  } catch (error) {
    console.error('Private chat GET API error:', error);
    return apiError('Failed to load messages', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsedBody = privateChatMessageSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return apiError('Missing required fields', { status: 400, code: 'INVALID_BODY' });
    }

    const session = getTenantFromRequest(request);
    const { type, username, message, timestamp } = parsedBody.data;

    await appendPrivateChatMessages(
      [{ type, username, message, timestamp }],
      100,
      session?.tenantId
    );

    console.log(`[Private Chat] Saved ${type} message from ${username}`);
    return apiOk({ success: true });
  } catch (error) {
    console.error('Private chat API error:', error);
    return apiError('Failed to save message', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
