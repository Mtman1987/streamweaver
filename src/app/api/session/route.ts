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
  response.cookies.delete('streamweaver-session');
  response.cookies.delete('streamweaver-spmt-token');
  response.cookies.delete('streamweaver-spmt-refresh');
  response.cookies.delete('streamweaver-spmt-state');
  return response;
}
