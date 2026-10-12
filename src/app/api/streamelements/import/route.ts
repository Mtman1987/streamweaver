import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getStreamElementsStatus, importStreamElements } from '@/services/streamelements';
export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request); if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json(await getStreamElementsStatus({ tenantId: session.tenantId, username: session.username }));
}
export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request); if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  try { return NextResponse.json(await importStreamElements({ tenantId: session.tenantId, username: session.username })); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'StreamElements import failed' }, { status: 400 }); }
}
