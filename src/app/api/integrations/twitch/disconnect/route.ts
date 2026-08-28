import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { z } from 'zod';

import { getStoredTokens, storeTokens, type StoredTokens } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { communityBotTokensPath, isAdmin, tenantPath } from '@/lib/tenant';
import { apiError, apiOk } from '@/lib/api-response';

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
  } else {
    delete next.botToken;
    delete next.botRefreshToken;
    delete next.botTokenExpiry;
    delete next.botUsername;
  }

  next.lastUpdated = new Date().toISOString();
  return next;
}

function hasAnyTwitchTokens(tokens: StoredTokens): boolean {
  return Boolean(
    tokens.broadcasterToken ||
      tokens.broadcasterRefreshToken ||
      tokens.botToken ||
      tokens.botRefreshToken
  );
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

    try {
      await fs.unlink(communityBotTokensPath());
    } catch {}

    try {
      const wsPort = process.env.WS_PORT || '8090';
      await fetch(`http://127.0.0.1:${wsPort}/api/twitch/community-bot/disconnect`, {
        method: 'POST',
      }).catch(() => {});
    } catch {}

    return apiOk({ ok: true });
  }

  const tokens = await getStoredTokens(tenantId);
  if (!tokens) {
    return apiOk({ ok: true });
  }

  const updated = stripRole(tokens, role);

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

  if (!hasAnyTwitchTokens(updated)) {
    try {
      await fs.unlink(tenantPath(tenantId, 'tokens/twitch-tokens.json'));
    } catch {}
    return apiOk({ ok: true });
  }

  await storeTokens(updated, tenantId);
  return apiOk({ ok: true });
}
