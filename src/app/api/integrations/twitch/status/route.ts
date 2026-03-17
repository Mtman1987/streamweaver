import { NextResponse } from 'next/server';
import { getStoredTokens } from '@/lib/token-utils.server';

export async function GET() {
  const tokens = await getStoredTokens();

  const broadcasterConnected = !!(tokens?.broadcasterToken && tokens?.broadcasterRefreshToken);
  const botConnected = !!(tokens?.botToken && tokens?.botRefreshToken);
  const communityBotConnected = !!(tokens?.communityBotToken && tokens?.communityBotRefreshToken);
  const appLoginConnected = !!(tokens?.loginToken && tokens?.loginRefreshToken);

  return NextResponse.json({
    broadcasterConnected,
    botConnected,
    communityBotConnected,
    appLoginConnected,
    broadcasterUsername: tokens?.broadcasterUsername || null,
    botUsername: tokens?.botUsername || null,
    communityBotUsername: tokens?.communityBotUsername || null,
    appLoginUsername: tokens?.loginUsername || null,
    lastUpdated: tokens?.lastUpdated || null,
  });
}
