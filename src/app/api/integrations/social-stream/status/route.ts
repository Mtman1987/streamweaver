import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';

import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  const safeTenantId = session.tenantId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  const statePath = path.join(String(process.env.PERSIST_ROOT || process.cwd()), 'data', `social-stream-bridge-${safeTenantId}.json`);
  try {
    const state = JSON.parse(await readFile(statePath, 'utf-8'));
    const updatedAt = typeof state.updatedAt === 'string' ? state.updatedAt : null;
    const stale = !updatedAt || Date.now() - new Date(updatedAt).getTime() > 60_000;
    return apiOk({
      configured: true,
      connected: state.connected === true && !stale,
      stale,
      reconnectCount: Number(state.reconnectCount || 0),
      lastConnectedAt: state.lastConnectedAt || null,
      lastDisconnectedAt: state.lastDisconnectedAt || null,
      lastMessageAt: state.lastMessageAt || null,
      lastPongAt: state.lastPongAt || null,
      lastForwardedId: state.lastForwardedId || null,
      updatedAt,
    });
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return apiOk({ configured: false, connected: false, stale: true });
    }
    return apiError('Social Stream bridge health could not be read', { status: 500, code: 'HEALTH_READ_FAILED' });
  }
}
