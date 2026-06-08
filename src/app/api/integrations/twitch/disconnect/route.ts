import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { z } from 'zod';

import { getStoredTokens, storeTokens, type StoredTokens } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { communityBotTokensPath, tenantPath } from '@/lib/tenant';
import { apiError, apiOk } from '@/lib/api-response';

type Role = 'broadcaster' | 'bot' | 'community-bot';

const disconnectSchema = z.object({
  role: z.enum(['broadcaster', 'bot', 'community-bot']).optional().default('broadcaster'),
});

function stripRole(tokens: StoredTokens, role: Role): StoredTokens {
  const next: StoredTokens = { ...tokens };

  if (role === 'broadcaster') {
    delete next.broadcasterToken;
    delete next.broadcasterRefreshToken;
    delete next.broadcasterTokenExpiry;
    delete next.broadcasterUsername;
  } else if (role === 'bot') {
    delete next.botToken;
    delete next.botRefreshToken;
    delete next.botTokenExpiry;
    delete next.botUsername;
  } else if (role === 'community-bot') {
    delete next.communityBotToken;
    delete next.communityBotRefreshToken;
    delete next.communityBotTokenExpiry;
    delete next.communityBotUsername;
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

  const tokens = await getStoredTokens(tenantId);
  if (!tokens) {
    return apiOk({ ok: true });
  }

  const updated = stripRole(tokens, role);

  if (role === 'community-bot') {
    try {
      await fs.unlink(communityBotTokensPath());
    } catch {
      // ignore
    }

    try {
      const wsPort = process.env.WS_PORT || '8090';
      await fetch(`http://127.0.0.1:${wsPort}/api/twitch/community-bot/disconnect`, {
        method: 'POST',
      }).catch(() => {});
    } catch {
      // Runtime disconnect is best-effort; deleting the global token file remains source of truth.
    }

    return apiOk({ ok: true });
  }

  if (role === 'broadcaster' && tenantId) {
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
    } catch {
      // Runtime disconnect is best-effort; token removal below remains source of truth.
    }
  }

  if (!hasAnyTwitchTokens(updated)) {
    const tokensFile = tenantId
      ? tenantPath(tenantId, 'tokens/twitch-tokens.json')
      : require('path').resolve(process.cwd(), 'tokens', 'twitch-tokens.json');
    try {
      await fs.unlink(tokensFile);
    } catch {
      // ignore
    }
    return apiOk({ ok: true });
  }

  await storeTokens(updated, tenantId);
  return apiOk({ ok: true });
}
