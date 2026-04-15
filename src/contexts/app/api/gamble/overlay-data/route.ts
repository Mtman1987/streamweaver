import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import { apiError } from '@/lib/api-response';
import { tenantPath } from '@/lib/tenant';

export async function GET(req: NextRequest) {
    try {
        const tenantId = req.nextUrl.searchParams.get('tenant') || undefined;
        const tenantOverlayPath = tenantId
            ? tenantPath(tenantId, 'data/masterstats/overlay/gamble.json')
            : '';
        const globalOverlayPath = path.resolve(process.cwd(), 'data', 'masterstats', 'overlay', 'gamble.json');
        const candidatePaths = [tenantOverlayPath, globalOverlayPath].filter(Boolean);

        for (const overlayPath of candidatePaths) {
            try {
                const data = await fs.readFile(overlayPath, 'utf-8');
                return NextResponse.json(JSON.parse(data));
            } catch {
                // try next candidate
            }
        }

        return NextResponse.json({ type: 'none', text: '', payload: null });
    } catch (error: any) {
        console.error('[Gamble Overlay API] Error:', error);
        return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
    }
}
