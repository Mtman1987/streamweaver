import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { resolveTenantId } from '@/lib/mountainview-tenant';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const tenantId = resolveTenantId(request, body?.tenantId);
    if (!tenantId) {
      return apiError('Not authenticated', { status: 401, code: 'UNAUTHORIZED' });
    }

    console.log(`[Stream Stop API] Stopping Twitch client for tenant ${tenantId}...`);
    const wsPort = process.env.WS_PORT || '8090';
    const res = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    });
    if (!res.ok) {
      const err = await res.text();
      return apiError(`Stop failed: ${err}`, { status: 500, code: 'STOP_FAILED' });
    }
    return apiOk({ success: true, message: 'Stream workflow stopped' });
  } catch (error) {
    console.error('[Stream Stop API] Failed to stop:', error);
    return apiError('Failed to stop stream workflow', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
