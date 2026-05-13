import { NextRequest, NextResponse } from 'next/server';
import { getAllKickInstances } from '@/services/kick';

export const dynamic = 'force-dynamic';

const EXPECTED_SECRET = process.env.CHAT_TAG_SECRET || process.env.BOT_SECRET_KEY || '1234';

/**
 * POST /api/kick/chat-tag-broadcast
 * Called by chat-tag to broadcast messages to Kick channels via StreamWeaver's Kick connections.
 * Body: { message, channels: string[], secret }
 */
export async function POST(req: NextRequest) {
  try {
    const { message, channels, secret } = await req.json();

    if (secret !== EXPECTED_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!message || !channels?.length) {
      return NextResponse.json({ error: 'message and channels required' }, { status: 400 });
    }

    const instances = getAllKickInstances();
    let sent = 0;

    for (const [, kick] of instances) {
      if (!kick.isConnected()) continue;
      const channelName = kick.getChannelName()?.toLowerCase();
      if (channelName && channels.includes(channelName)) {
        try {
          await kick.sendChatMessage(message);
          sent++;
        } catch (e: any) {
          console.warn(`[Kick Broadcast] Failed to send to ${channelName}:`, e.message);
        }
      }
    }

    return NextResponse.json({ success: true, sent });
  } catch (error: any) {
    console.error('[Kick Broadcast] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
