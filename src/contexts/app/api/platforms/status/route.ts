import { NextRequest, NextResponse } from 'next/server';
import { getMultiPlatformManager } from '@/services/multi-platform';
export async function GET(request: NextRequest) {
  const manager = getMultiPlatformManager();
  const status = manager.getStatus();

  return NextResponse.json({
    youtubeConnected: Boolean(status.youtube),
    kickConnected: Boolean(status.kick),
    tiktokConnected: Boolean(status.tiktok),
    discordConnected: Boolean(process.env.DISCORD_BOT_TOKEN),
  });
}
