import { NextRequest } from 'next/server';
import { apiOk, apiError } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getKickServiceForTenant, getKickService } from '@/services/kick';

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });

  const tenantId = session.tenantId;
  let kick = getKickServiceForTenant(tenantId);

  // If no tenant instance running, try to get/create one and connect
  if (!kick || !kick.isConnected()) {
    kick = getKickService(tenantId);
    if (!kick.isConnected()) {
      return apiError('Kick chat not connected. Connect Channel Chat first.', { status: 400 });
    }
  }

  if (!kick.hasAuth()) {
    return apiError('No bot token available. Link a Kick Broadcaster or Bot account first.', { status: 400 });
  }

  try {
    await kick.sendChatMessage('✅ StreamWeaver bot connection test successful!');
    return apiOk({ sent: true });
  } catch (error: any) {
    return apiError(`Failed to send: ${error?.message || error}`, { status: 500 });
  }
}
