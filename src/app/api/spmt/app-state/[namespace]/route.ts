import { NextRequest, NextResponse } from 'next/server';
import {
  applyRefreshedSpmtCookies,
  refreshSpmtConnection,
  type RefreshedSpmtConnection,
} from '@/lib/spmt-oauth';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

async function forward(request: NextRequest, namespace: string, method: 'GET' | 'PUT') {
  let token = request.cookies.get('streamweaver-spmt-token')?.value || '';
  let refreshed: RefreshedSpmtConnection | null = null;
  if (!token) {
    refreshed = await refreshSpmtConnection(request);
    if (!refreshed) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    token = refreshed.accessToken;
  }
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(namespace)) return NextResponse.json({ error: 'Invalid namespace' }, { status: 400 });

  const ifMatch = request.headers.get('if-match');
  const body = method === 'PUT' ? JSON.stringify(await request.json().catch(() => ({}))) : undefined;
  const send = (accessToken: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };
    if (ifMatch) headers['If-Match'] = ifMatch;
    if (body) headers['Content-Type'] = 'application/json';
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(8000)
      : undefined;
    return fetch(`${SPMT_BASE_URL}/api/app-state/streamweaver/${namespace}`, {
      method,
      headers,
      body,
      cache: 'no-store',
      signal,
    });
  };
  let response = await send(token);
  if (response.status === 401 || response.status === 403) {
    refreshed = await refreshSpmtConnection(request);
    if (refreshed) {
      token = refreshed.accessToken;
      response = await send(token);
    }
  }
  const payload = await response.json().catch(() => ({ error: 'Invalid SPMT response' }));
  const next = NextResponse.json(payload, { status: response.status });
  const etag = response.headers.get('etag');
  if (etag) next.headers.set('etag', etag);
  if (refreshed) applyRefreshedSpmtCookies(next, refreshed);
  return next;
}

export async function GET(request: NextRequest, context: { params: Promise<{ namespace: string }> }) {
  return forward(request, (await context.params).namespace, 'GET');
}

export async function PUT(request: NextRequest, context: { params: Promise<{ namespace: string }> }) {
  return forward(request, (await context.params).namespace, 'PUT');
}
