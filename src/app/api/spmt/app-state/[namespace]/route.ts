import { NextRequest, NextResponse } from 'next/server';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

async function forward(request: NextRequest, namespace: string, method: 'GET' | 'PUT') {
  const token = request.cookies.get('streamweaver-spmt-token')?.value || '';
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(namespace)) return NextResponse.json({ error: 'Invalid namespace' }, { status: 400 });

  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const ifMatch = request.headers.get('if-match');
  if (ifMatch) headers['If-Match'] = ifMatch;
  const body = method === 'PUT' ? JSON.stringify(await request.json().catch(() => ({}))) : undefined;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${SPMT_BASE_URL}/api/app-state/streamweaver/${namespace}`, {
    method,
    headers,
    body,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({ error: 'Invalid SPMT response' }));
  const next = NextResponse.json(payload, { status: response.status });
  const etag = response.headers.get('etag');
  if (etag) next.headers.set('etag', etag);
  return next;
}

export async function GET(request: NextRequest, context: { params: Promise<{ namespace: string }> }) {
  return forward(request, (await context.params).namespace, 'GET');
}

export async function PUT(request: NextRequest, context: { params: Promise<{ namespace: string }> }) {
  return forward(request, (await context.params).namespace, 'PUT');
}
