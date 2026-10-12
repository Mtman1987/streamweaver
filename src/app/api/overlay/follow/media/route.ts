import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { tenantPath } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
    const tenant = request.nextUrl.searchParams.get('tenant') || '';
    if (!/^[a-zA-Z0-9_-]+$/.test(tenant)) return new NextResponse(null, { status: 400 });
    let data: Buffer;
    try { data = await fs.readFile(tenantPath(tenant, 'data/follow-alert/best-friends.mp4')); }
    catch { return new NextResponse(null, { status: 404 }); }
    const headers: Record<string, string> = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600' };
    const range = request.headers.get('range');
    if (range) {
        const match = range.match(/^bytes=(\d*)-(\d*)$/);
        if (!match || (!match[1] && !match[2])) return new NextResponse(null, { status: 416, headers: { 'Content-Range': 'bytes */' + data.length } });
        const start = match[1] ? Number(match[1]) : Math.max(0, data.length - Number(match[2]));
        const end = match[1] && match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
        if (start >= data.length || start > end) return new NextResponse(null, { status: 416, headers: { 'Content-Range': 'bytes */' + data.length } });
        headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + data.length;
        headers['Content-Length'] = String(end - start + 1);
        return new NextResponse(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers });
    }
    headers['Content-Length'] = String(data.length);
    return new NextResponse(new Uint8Array(data), { headers });
}
