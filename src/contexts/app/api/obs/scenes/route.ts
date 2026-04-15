import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getConfigSection, updateConfigSection, initializeLocalConfig } from '@/lib/local-config/service';

export async function GET() {
  await initializeLocalConfig();
  const obs = await getConfigSection('obs');
  return apiOk({ scenes: obs.scenes });
}

export async function PUT(request: NextRequest) {
  await initializeLocalConfig();
  const body = await request.json().catch(() => null);
  if (!body?.scenes || typeof body.scenes !== 'object') {
    return apiError('Invalid body — expected { scenes: { ... } }', { status: 400 });
  }
  const updated = await updateConfigSection('obs', { scenes: body.scenes });
  return apiOk({ scenes: updated.scenes });
}
