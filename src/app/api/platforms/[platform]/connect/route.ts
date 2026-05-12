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

      // Signal the server process to connect (runs outside Next.js bundle)
      try {
        const connectFn = (global as any).__kickConnect;
        if (connectFn) {
          connectFn(username, tenantId).catch((e: any) => console.error('[Kick] Background connect failed:', e));
        } else {
          console.log('[Kick] No server-side connect function available. Will connect on next restart.');
        }
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
