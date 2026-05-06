import { NextRequest, NextResponse } from 'next/server';
import { getConfigSection, initializeLocalConfig, validateLocalApiKey } from '@/lib/local-config/service';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const tenantId = session?.tenantId;
  await initializeLocalConfig(tenantId);
  const app = await getConfigSection('app', tenantId);
  const key = request.headers.get('x-api-key') || '';
  const authorized = await validateLocalApiKey(key);

  return NextResponse.json({
    requireApiKey: app.security.requireApiKey,
    hasConfiguredApiKey: Boolean(app.security.apiKey),
    authorized,
    host: app.server.host,
    port: app.server.port,
  });
}
