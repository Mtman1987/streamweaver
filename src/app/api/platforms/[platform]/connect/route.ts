import { NextRequest, NextResponse } from 'next/server';
import { getMultiPlatformManager } from '@/services/multi-platform';
import { z } from 'zod';

const connectPlatformSchema = z.enum(['kick', 'tiktok']);
const disconnectPlatformSchema = z.enum(['youtube', 'kick', 'tiktok']);
const connectBodySchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(64, 'Username is too long'),
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
      await multiPlatform.connectKick(username);
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
