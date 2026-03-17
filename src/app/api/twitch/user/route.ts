import { NextRequest } from 'next/server';
import { getTwitchUser } from '@/services/twitch';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const login = searchParams.get('login');
    const id = searchParams.get('id');

    if (!login && !id) {
      return apiError('Either login or id parameter is required', { status: 400, code: 'MISSING_QUERY' });
    }

    const user = await getTwitchUser(login || id!, login ? 'login' : 'id');
    
    if (!user) {
      return apiError('User not found', { status: 404, code: 'USER_NOT_FOUND' });
    }

    return apiOk(user as Record<string, unknown>);

  } catch (error) {
    console.error('Error in Twitch user API:', error);
    return apiError('Failed to fetch user data', { status: 500, code: 'INTERNAL_ERROR' });
  }
}