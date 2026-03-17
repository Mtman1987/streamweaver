import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { z } from 'zod';

import { getStoredTokens, storeTokens, type StoredTokens } from '@/lib/token-utils.server';
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

  const tokens = await getStoredTokens();
  if (!tokens) {
    return apiOk({ ok: true });
  }

  const updated = stripRole(tokens, role);

  if (!hasAnyTwitchTokens(updated)) {
    // If we've cleared everything, remove the file entirely.
    const tokensFile = resolve(process.cwd(), 'tokens', 'twitch-tokens.json');
    try {
      await fs.unlink(tokensFile);
    } catch {
      // ignore
    }
    return apiOk({ ok: true });
  }

  await storeTokens(updated);
  return apiOk({ ok: true });
}
