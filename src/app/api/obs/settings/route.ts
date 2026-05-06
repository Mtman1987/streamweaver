import { NextRequest } from 'next/server';
import { readVault } from '@/lib/vault-store';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiOk } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  // Try tenant vault first, fall back to global
  let obs: any = {};
  if (session?.tenantId) {
    const tenantVault = await readVault(session.tenantId);
    obs = (tenantVault as any)?.obs || {};
  }
  if (!obs.ip) {
    const globalVault = await readVault();
    obs = (globalVault as any)?.obs || {};
  }
  return apiOk({ ip: obs.ip || '', port: obs.port || '', password: obs.password || '' });
}
