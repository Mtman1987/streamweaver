import { NextRequest } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { hasMountainViewBridgeAccess } from '@/lib/internal-service-auth';
import { apiError, apiOk } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    let tenantId = session?.tenantId || '';
    if (!tenantId && hasMountainViewBridgeAccess(request)) {
      const body = await request.json().catch(() => null);
      tenantId = String(body?.tenantId || '').trim();
    }
    if (!tenantId) {
      return apiError('Not authenticated', { status: 401, code: 'UNAUTHORIZED' });
    }
    console.log(`[Twitch Start API] Starting Twitch client for tenant ${tenantId}...`);
    const wsPort = process.env.WS_PORT || '8090';
    const res = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    });
    if (!res.ok) {
      const err = await res.text();
      return apiError(`Reconnect failed: ${err}`, { status: 500, code: 'RECONNECT_FAILED' });
    }
    return apiOk({ success: true, message: 'Twitch client started' });
  } catch (error) {
    console.error('[Twitch Start API] Failed to start client:', error);
    return apiError('Failed to start Twitch client', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
