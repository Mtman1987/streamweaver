import { NextRequest, NextResponse } from 'next/server';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

export async function GET(request: NextRequest) {
  const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
  const response = NextResponse.redirect(`${appOrigin}/login`);
  response.cookies.delete('streamweaver-session');
  response.cookies.delete('streamweaver-spmt-token');
  response.cookies.delete('streamweaver-spmt-refresh');
  response.cookies.delete('streamweaver-spmt-state');
  return response;
}
