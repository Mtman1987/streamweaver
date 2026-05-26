import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { isAdmin } from '@/lib/tenant';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { addAthenaWhitelistUser, ATHENA_WHITELIST_TENANT_ID, getAthenaWhitelist, removeAthenaWhitelistUser } from '@/services/athena-whitelist';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });
  if (!isAdmin(session.tenantId)) return apiError('Admin only', { status: 403 });

  return apiOk({ users: await getAthenaWhitelist(ATHENA_WHITELIST_TENANT_ID) });
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });
  if (!isAdmin(session.tenantId)) return apiError('Admin only', { status: 403 });

  const { username, action } = await request.json().catch(() => ({}));
  if (!username || typeof username !== 'string') {
    return apiError('Missing username', { status: 400 });
  }

  if (action === 'remove') {
    await removeAthenaWhitelistUser(username, ATHENA_WHITELIST_TENANT_ID);
    return apiOk({ removed: username.toLowerCase().replace(/^@/, '') });
  }

  await addAthenaWhitelistUser(username, ATHENA_WHITELIST_TENANT_ID);
  return apiOk({ added: username.toLowerCase().replace(/^@/, '') });
}
