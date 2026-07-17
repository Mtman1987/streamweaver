import { NextRequest, NextResponse } from 'next/server';
import { isDiscordMediaSlot, readDiscordMedia } from '@/lib/discord-media-store';

export async function GET(request: NextRequest, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const slot = String(file || '').replace(/\.gif$/i, '');

  if (!isDiscordMediaSlot(slot)) {
    return NextResponse.json({ error: 'Invalid media slot' }, { status: 404 });
  }

  const tenantId = request.nextUrl.searchParams.get('tenant') || undefined;
  const media = await readDiscordMedia(slot, tenantId);
  if (!media) {
    return NextResponse.json({ error: 'Discord media not found' }, { status: 404 });
  }

  return new NextResponse(media.body, {
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
}
