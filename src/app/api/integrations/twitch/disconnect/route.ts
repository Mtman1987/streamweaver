import { NextRequest } from 'next/server';
import { z } from 'zod';

import { getStoredTokens, updateStoredTokens, type StoredTokens } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { isAdmin } from '@/lib/tenant';
import { apiError, apiOk } from '@/lib/api-response';
import { internalServiceHeaders } from '@/lib/internal-service-auth';

type Role = 'broadcaster' | 'bot' | 'community-bot';

const disconnectSchema = z.object({
  role: z.enum(['broadcaster', 'bot', 'community-bot']).optional().default('broadcaster'),
});

function stripRole(tokens: StoredTokens, role: Exclude<Role, 'community-bot'>): StoredTokens {
  const next: StoredTokens = { ...tokens };

  if (role === 'broadcaster') {
    delete next.broadcasterToken;
    delete next.broadcasterRefreshToken;
    delete next.broadcasterTokenExpiry;
    delete next.broadcasterUsername;
    delete next.loginToken;
    delete next.loginRefreshToken;
    delete next.loginTokenExpiry;
  } else {
    delete next.botToken;
    delete next.botRefreshToken;
    delete next.botTokenExpiry;
    delete next.botUsername;
  }

  next.lastUpdated = new Date().toISOString();
  return next;
}

export async function POST(request: NextRequest) {
  const parsed = disconnectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
  }

  const role: Role = parsed.data.role;
  const session = getTenantFromRequest(request);
  const tenantId = session?.tenantId;
  if (!tenantId) {
    return apiError('Authentication required', { status: 401, code: 'AUTH_REQUIRED' });
  }

  if (role === 'community-bot') {
    if (!isAdmin(tenantId)) {
      return apiError('Owner authorization required', { status: 403, code: 'OWNER_REQUIRED' });
    }

    await updateStoredTokens(() => ({}), undefined, true);

    try {
      const wsPort = process.env.WS_PORT || '8090';
      await fetch(`http://127.0.0.1:${wsPort}/api/twitch/community-bot/disconnect`, {
        method: 'POST',
        headers: internalServiceHeaders(),
      }).catch(() => {});
    } catch {}

    return apiOk({ ok: true });
  }

  const tokens = await getStoredTokens(tenantId);
  if (!tokens) {
    return apiOk({ ok: true });
  }


  if (role === 'broadcaster') {
    try {
      const wsPort = process.env.WS_PORT || '8090';
      await fetch(`http://127.0.0.1:${wsPort}/api/twitch/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      }).catch(() => {});
      await fetch(`http://127.0.0.1:${wsPort}/api/kick/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      }).catch(() => {});
    } catch {}
  }

  await updateStoredTokens(current => stripRole(current, role), tenantId);
  return apiOk({ ok: true });
}
