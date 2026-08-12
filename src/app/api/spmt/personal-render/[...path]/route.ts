import { NextRequest, NextResponse } from 'next/server';
import { applyRefreshedSpmtCookies } from '@/lib/spmt-oauth';
import { fetchSpmtForUser } from '@/lib/spmt-user-proxy';

export const dynamic = 'force-dynamic';

function allowedPath(parts: string[]) {
  if (parts.length === 3 && parts[0] === 'tenant' && parts[2] === 'personal') {
    return /^[a-z0-9._-]{1,80}$/.test(parts[1]);
  }
  return parts.length === 2 && parts[0] === 'cloud-xbox' && (parts[1] === 'status' || parts[1] === 'frame');
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const parts = (await context.params).path || [];
  if (!allowedPath(parts)) return NextResponse.json({ error: 'Unsupported Personal render path' }, { status: 404 });

  const target = `/api/${parts.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const { response: upstream, refreshed } = await fetchSpmtForUser(request, target, {
    method: 'GET',
    headers: { Accept: request.headers.get('accept') || '*/*' },
  });
  if (!upstream) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const response = new NextResponse(upstream.body, { status: upstream.status });
  const contentType = upstream.headers.get('content-type');
  if (contentType) response.headers.set('content-type', contentType);
  response.headers.set('cache-control', 'no-store, max-age=0');
  response.headers.set('x-content-type-options', 'nosniff');
  if (refreshed) applyRefreshedSpmtCookies(response, refreshed);
  return response;
}
