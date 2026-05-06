import { NextRequest, NextResponse } from 'next/server';
import { getStoredTokens } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { communityBotTokensPath } from '@/lib/tenant';
import { promises as fs } from 'fs';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const tokens = await getStoredTokens(session?.tenantId);
  let communityFile: any = null;
  try {
    const raw = await fs.readFile(communityBotTokensPath(), 'utf-8');
    communityFile = JSON.parse(raw);
  } catch {}

  let runtimeState: { connected: boolean; username: string | null } = { connected: false, username: null };
  try {
    const { getCommunityBotRuntimeState } = await import('@/services/twitch-client');
    const state = getCommunityBotRuntimeState();
    runtimeState = { connected: !!state.connected, username: state.username || null };
  } catch {}

  const broadcasterConnected = !!(tokens?.broadcasterToken && tokens?.broadcasterRefreshToken);
  const botConnected = !!(tokens?.botToken && tokens?.botRefreshToken);
  const communityBotConfigured = !!(
    communityFile?.communityBotToken &&
    communityFile?.communityBotRefreshToken
  );
  const communityBotConnected = runtimeState.connected || communityBotConfigured;
  const appLoginConnected = !!(tokens?.loginToken && tokens?.loginRefreshToken);

  return NextResponse.json({
    broadcasterConnected,
    botConnected,
    communityBotConnected,
    appLoginConnected,
    broadcasterUsername: tokens?.broadcasterUsername || null,
    botUsername: tokens?.botUsername || null,
    communityBotUsername: runtimeState.username || communityFile?.communityBotUsername || null,
    appLoginUsername: tokens?.loginUsername || null,
    lastUpdated: tokens?.lastUpdated || null,
  });
}
