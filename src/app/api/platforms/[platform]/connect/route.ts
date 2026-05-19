import { NextRequest, NextResponse } from 'next/server';
import { getMultiPlatformManager } from '@/services/multi-platform';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { tenantPath } from '@/lib/tenant';
import { promises as fs } from 'fs';
import { z } from 'zod';

const connectPlatformSchema = z.enum(['kick', 'tiktok']);
const disconnectPlatformSchema = z.enum(['youtube', 'kick', 'tiktok']);
const connectBodySchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(64, 'Username is too long'),
  chatroomId: z.number().nullable().optional(),
  channelId: z.number().nullable().optional(),
});

/**
 * Connect to Kick or TikTok via username
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  try {
    const parsedBody = connectBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const { username } = parsedBody.data;

    const multiPlatform = getMultiPlatformManager();
    const { platform } = await params;
    const parsedPlatform = connectPlatformSchema.safeParse(platform);
    if (!parsedPlatform.success) {
      return NextResponse.json(
        { error: 'Invalid platform' },
        { status: 400 }
      );
    }

    if (parsedPlatform.data === 'kick') {
      const session = getTenantFromRequest(request);
      const tenantId = session?.tenantId;
      const { chatroomId, channelId } = parsedBody.data;

      // Store chatroom/channel IDs if provided (resolved client-side)
      if (tenantId && (chatroomId || channelId)) {
        try {
          const tokensFile = tenantPath(tenantId, 'tokens/kick-tokens.json');
          let existing: Record<string, any> = {};
          try { existing = JSON.parse(await fs.readFile(tokensFile, 'utf-8')); } catch {}
          if (chatroomId) existing.broadcasterChatroomId = String(chatroomId);
          if (channelId) existing.broadcasterChannelId = String(channelId);
          if (!existing.broadcasterUsername) existing.broadcasterUsername = username;
          await fs.writeFile(tokensFile, JSON.stringify(existing, null, 2));
          console.log(`[Kick] Stored chatroom=${chatroomId}, channel=${channelId} for tenant ${tenantId}`);
        } catch (e) {
          console.warn('[Kick] Failed to persist IDs:', e);
        }
      }

      // Signal the server process to connect via its HTTP endpoint (same process as Kick service)
      try {
        const wsPort = process.env.WS_PORT || '8090';
        fetch(`http://127.0.0.1:${wsPort}/api/kick/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelName: username, tenantId }),
        }).then(r => {
          if (!r.ok) r.text().then(t => console.error('[Kick] Server connect failed:', t));
        }).catch((e: any) => console.error('[Kick] Server connect request failed:', e));
      } catch {}

      return NextResponse.json({ success: true, platform: 'kick' });
    } 
    else {
      await multiPlatform.connectTikTok(username);
      return NextResponse.json({ success: true, platform: 'tiktok' });
    }

  } catch (error: any) {
    console.error(`Platform connection error:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to connect' },
      { status: 500 }
    );
  }
}

/**
 * Disconnect from platform
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  try {
    const multiPlatform = getMultiPlatformManager();
    const { platform: platformParam } = await params;
    const parsedPlatform = disconnectPlatformSchema.safeParse(platformParam);
    if (!parsedPlatform.success) {
      return NextResponse.json(
        { error: 'Invalid platform' },
        { status: 400 }
      );
    }

    const platform = parsedPlatform.data;

    if (platform === 'kick') {
      const session = getTenantFromRequest(request);
      const tenantId = session?.tenantId;
      try {
        const wsPort = process.env.WS_PORT || '8090';
        const response = await fetch(`http://127.0.0.1:${wsPort}/api/kick/disconnect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          console.warn('[Kick] Server disconnect failed:', response.status, text);
        }
      } catch (e) {
        console.warn('[Kick] Server disconnect request failed:', e);
      }
    }

    multiPlatform.disconnect(platform);

    return NextResponse.json({ success: true, platform });

  } catch (error: any) {
    console.error(`Platform disconnection error:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to disconnect' },
      { status: 500 }
    );
  }
}
