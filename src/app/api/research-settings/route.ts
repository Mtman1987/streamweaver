import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readResearchSettings, writeResearchSettings } from '@/services/research-mode';
import { getBotName } from '@/lib/bot-settings-store';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  return apiOk({ settings: await readResearchSettings(session.tenantId, getBotName(session.tenantId)) });
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
  }
  return apiOk({ settings: await writeResearchSettings(session.tenantId, body) });
}
