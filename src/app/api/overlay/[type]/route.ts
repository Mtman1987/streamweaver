import { NextRequest, NextResponse } from 'next/server';
import { getOverlayData } from '@/services/overlay-manager';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const { type } = await params;
    const data = await getOverlayData(type);
    
    if (!data) {
      return apiError('No data', { status: 404, code: 'NOT_FOUND' });
    }
    
    return apiOk(data as Record<string, unknown>);
  } catch (error: any) {
    console.error('[Overlay API] Error:', error);
    return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
  }
}
