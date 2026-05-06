import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getConfigSection, updateConfigSection, initializeLocalConfig } from '@/lib/local-config/service';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const tenantId = session?.tenantId;
  await initializeLocalConfig(tenantId);
  const obs = await getConfigSection('obs', tenantId);
  return apiOk({ scenes: obs.scenes });
}

export async function PUT(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const tenantId = session?.tenantId;
  await initializeLocalConfig(tenantId);
  const body = await request.json().catch(() => null);
  if (!body?.scenes || typeof body.scenes !== 'object') {
    return apiError('Invalid body — expected { scenes: { ... } }', { status: 400 });
  }
  const updated = await updateConfigSection('obs', { scenes: body.scenes }, tenantId);
  return apiOk({ scenes: updated.scenes });
}
