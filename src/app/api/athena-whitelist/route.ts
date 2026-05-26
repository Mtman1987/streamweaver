import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { addAthenaWhitelistUser, getAthenaWhitelist, removeAthenaWhitelistUser } from '@/services/athena-whitelist';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });

  return apiOk({ users: await getAthenaWhitelist(session.tenantId) });
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });

  const { username, action } = await request.json().catch(() => ({}));
  if (!username || typeof username !== 'string') {
    return apiError('Missing username', { status: 400 });
  }

  if (action === 'remove') {
    await removeAthenaWhitelistUser(username, session.tenantId);
    return apiOk({ removed: username.toLowerCase().replace(/^@/, '') });
  }

  await addAthenaWhitelistUser(username, session.tenantId);
  return apiOk({ added: username.toLowerCase().replace(/^@/, '') });
}
