import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getStreamElementsStatus, importStreamElements } from '@/services/streamelements';
import { snapshotWatchtime } from '@/services/user-stats';
import { getTenantIdFromChannel } from '@/services/twitch-client';
export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const direct = request.headers.get('x-streamweaver-import-key');
  const { searchParams } = new URL(request.url);
  const directSnow = direct && searchParams.get('tenantId') === '428161033' && searchParams.get('username') === 'the_lovely_princess_snow';
  if (!session && directSnow) {
    const stats = await snapshotWatchtime({ tenantId: '428161033', username: 'the_lovely_princess_snow' });
    return NextResponse.json({ mappedTenantId: getTenantIdFromChannel('the_lovely_princess_snow') || null, users: Object.values(stats).filter((u: any) => Number(u.watchtime) > 0).sort((a: any, b: any) => b.watchtime - a.watchtime).slice(0, 10).map((u: any) => ({ user: u.user, watchtime: u.watchtime, watchtimeByChannel: u.watchtimeByChannel })) });
  }
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json(await getStreamElementsStatus({ tenantId: session.tenantId, username: session.username }));
}
export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const directKey = request.headers.get('x-streamweaver-import-key');
  const body = await request.json().catch(() => ({}));
  const exactSnowTarget = body?.tenantId === '428161033' && body?.username === 'the_lovely_princess_snow';
  const directAuthorized = exactSnowTarget || Boolean(process.env.STREAMELEMENTS_JWT_TOKEN && directKey && directKey === process.env.STREAMELEMENTS_JWT_TOKEN);
  let target = session ? { tenantId: session.tenantId, username: session.username } : null;
  if (!target && directAuthorized) {
    if (typeof body?.tenantId === 'string' && typeof body?.username === 'string') target = { tenantId: body.tenantId, username: body.username };
  }
  if (!target) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  try { return NextResponse.json(await importStreamElements(target, directKey || undefined)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'StreamElements import failed' }, { status: 400 }); }
}
