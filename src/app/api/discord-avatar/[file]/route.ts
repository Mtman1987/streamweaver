import { NextRequest, NextResponse } from 'next/server';
import { readDiscordAvatarThumbnail } from '@/services/discord-avatar-media';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (String(file || '').toLowerCase() !== 'idle.gif') {
    return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
  }

  const rawTenantId = request.nextUrl.searchParams.get('tenant') || '';
  if (rawTenantId && !/^[a-zA-Z0-9_-]{1,128}$/.test(rawTenantId)) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 400 });
  }
  const tenantId = rawTenantId || undefined;
  const body = await readDiscordAvatarThumbnail(tenantId);
  if (!body) {
    return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'public, max-age=86400, immutable',
      'access-control-allow-origin': '*',
      'x-streamweaver-avatar-variant': 'discord-thumbnail',
    },
  });
}
