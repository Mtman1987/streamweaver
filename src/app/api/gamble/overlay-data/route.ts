import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import { apiError } from '@/lib/api-response';

export async function GET(req: NextRequest) {
    try {
        const overlayPath = path.resolve(process.cwd(), 'data', 'masterstats', 'overlay', 'gamble.json');
        
        try {
            const data = await fs.readFile(overlayPath, 'utf-8');
            return NextResponse.json(JSON.parse(data));
        } catch {
            return NextResponse.json({ type: 'none', text: '', payload: null });
        }
    } catch (error: any) {
        console.error('[Gamble Overlay API] Error:', error);
        return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
    }
}
