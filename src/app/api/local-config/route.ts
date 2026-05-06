import { NextRequest } from 'next/server';
import { getPublicConfigAll, initializeLocalConfig } from '@/lib/local-config/service';
import { apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const tenantId = session?.tenantId;
  await initializeLocalConfig(tenantId);
  const config = await getPublicConfigAll(tenantId);
  return apiOk({ config });
}
