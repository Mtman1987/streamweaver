import { NextRequest, NextResponse } from 'next/server';
import { parseSessionCookie } from '@/lib/session-cookie';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = parseSessionCookie(request.cookies.get('streamweaver-session')?.value);
  if (!session?.id) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const galleryUrl = new URL('/api/ai/image/library', request.url);
  galleryUrl.searchParams.set('tenantId', session.id);
  galleryUrl.searchParams.set('scope', 'private');
  return NextResponse.redirect(galleryUrl);
}
