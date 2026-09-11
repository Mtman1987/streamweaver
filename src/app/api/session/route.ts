import { clearSpmtSessionCookies } from '@/lib/spmt-oauth';
import { NextRequest, NextResponse } from 'next/server';
import { parseSessionCookie } from '@/lib/session-cookie';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('streamweaver-session')?.value;
  if (!sessionCookie) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const session = parseSessionCookie(sessionCookie);
  if (!session) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }
  return NextResponse.json(session);
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  clearSpmtSessionCookies(response);
  return response;
}
