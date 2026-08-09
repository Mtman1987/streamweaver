import { NextRequest, NextResponse } from 'next/server';
import { parseSessionCookie } from '@/lib/session-cookie';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const appUrl = getConfiguredAppUrl();
  const session = parseSessionCookie(request.cookies.get('streamweaver-session')?.value);
  if (!session?.id) {
    return NextResponse.redirect(new URL('/login', appUrl));
  }

  const galleryUrl = new URL('/api/ai/image/library', appUrl);
  galleryUrl.searchParams.set('tenantId', session.id);
  galleryUrl.searchParams.set('scope', 'private');
  return NextResponse.redirect(galleryUrl);
}
