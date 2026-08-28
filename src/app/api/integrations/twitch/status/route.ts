import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';

import { getStoredTokens } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { communityBotTokensPath, isAdmin } from '@/lib/tenant';
import { getTheCountTwitchCredentialStatus } from '@/lib/the-count-twitch-vault.server';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const owner = isAdmin(session.tenantId);
  const tokens = await getStoredTokens(session.tenantId);
  let communityFile: any = null;
  let runtimeState: { connected: boolean; username: string | null } = {
    connected: false,
    username: null,
  };
  let theCount = { configured: false, login: null as string | null };

  // Global bot identities and their management state are owner-private.
  if (owner) {
    try {
      communityFile = JSON.parse(await fs.readFile(communityBotTokensPath(), 'utf-8'));
    } catch {}

    try {
      const { getCommunityBotRuntimeState } = await import('@/services/twitch-client');
      const state = getCommunityBotRuntimeState();
      runtimeState = { connected: !!state.connected, username: state.username || null };
    } catch {}

    try {
      theCount = await getTheCountTwitchCredentialStatus();
    } catch (error) {
      console.warn('[Twitch status] Could not read The Count credential status:', error);
    }
  }

  const broadcasterConnected = !!(tokens?.broadcasterToken && tokens?.broadcasterRefreshToken);
  const botConnected = !!(tokens?.botToken && tokens?.botRefreshToken);
  const communityBotConfigured = owner && !!(
    communityFile?.communityBotToken &&
    communityFile?.communityBotRefreshToken
  );
  const appLoginConnected = !!(tokens?.loginToken && tokens?.loginRefreshToken);

  return NextResponse.json({
    broadcasterConnected,
    botConnected,
    appLoginConnected,
    broadcasterUsername: tokens?.broadcasterUsername || null,
    botUsername: tokens?.botUsername || null,
    appLoginUsername: tokens?.loginUsername || null,
    lastUpdated: tokens?.lastUpdated || null,
    owner,
    ...(owner ? {
      communityBotConnected: runtimeState.connected || communityBotConfigured,
      communityBotUsername: runtimeState.username || communityFile?.communityBotUsername || null,
      theCountConnected: theCount.configured,
      theCountUsername: theCount.login,
    } : {}),
  });
}
