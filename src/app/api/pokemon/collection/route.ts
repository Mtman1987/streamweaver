import { NextRequest, NextResponse } from 'next/server';
import { getUserCollection } from '@/services/pokemon-tcg';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const username = req.nextUrl.searchParams.get('username');
    
    if (!username) {
      return apiError('Username required', { status: 400, code: 'MISSING_USERNAME' });
    }
    
    const collection = await getUserCollection(username);
    return apiOk(collection);
  } catch (error: any) {
    console.error('[Pokemon] Collection error:', error);
    return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
  }
}
