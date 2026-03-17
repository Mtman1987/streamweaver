import { NextRequest, NextResponse } from 'next/server';
import { getConfigSection, initializeLocalConfig, validateLocalApiKey } from '@/lib/local-config/service';

export async function GET(request: NextRequest) {
  await initializeLocalConfig();
  const app = await getConfigSection('app');
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
