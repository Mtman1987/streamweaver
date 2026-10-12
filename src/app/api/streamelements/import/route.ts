import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getStreamElementsStatus, importStreamElements } from '@/services/streamelements';
export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request); if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json(await getStreamElementsStatus({ tenantId: session.tenantId, username: session.username }));
}
export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const directKey = request.headers.get('x-streamweaver-import-key');
  const directAuthorized = Boolean(process.env.STREAMELEMENTS_JWT_TOKEN && directKey && directKey === process.env.STREAMELEMENTS_JWT_TOKEN);
  let target = session ? { tenantId: session.tenantId, username: session.username } : null;
  if (!target && directAuthorized) {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.tenantId === 'string' && typeof body?.username === 'string') target = { tenantId: body.tenantId, username: body.username };
  }
  if (!target) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  try { return NextResponse.json(await importStreamElements(target)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'StreamElements import failed' }, { status: 400 }); }
}
