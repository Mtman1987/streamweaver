import { NextRequest, NextResponse } from 'next/server';
import { readFollowAlerts, recordFollowOverlayPresence } from '@/services/follow-alert';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
    const tenant = request.nextUrl.searchParams.get('tenant') || '';
    if (!/^[a-zA-Z0-9_-]+$/.test(tenant)) return NextResponse.json({ error: 'Tenant required' }, { status: 400 });
    const raw = request.nextUrl.searchParams.get('after');
    const after = raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;
    const status = request.nextUrl.searchParams.get('status');
    if (['ready', 'playing', 'blocked', 'media-error'].includes(status || ''))
        await recordFollowOverlayPresence(tenant, status as any);
    return NextResponse.json(await readFollowAlerts(tenant, after), { headers: { 'Cache-Control': 'no-store' } });
}
