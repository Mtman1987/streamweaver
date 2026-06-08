import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { readPublicChatMessages } from '@/lib/public-chat-store';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const messages = await readPublicChatMessages(undefined, session?.tenantId);
    return apiOk({ messages });
  } catch (error) {
    console.error('[Public Chat API] Failed to load messages:', error);
    return apiError('Failed to load public chat messages', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
