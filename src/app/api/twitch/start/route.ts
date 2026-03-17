import { setupTwitchClient } from '@/services/twitch-client';
import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    console.log('[Twitch Start API] Starting Twitch client...');
    await setupTwitchClient();
    return apiOk({ success: true, message: 'Twitch client started' });
  } catch (error) {
    console.error('[Twitch Start API] Failed to start client:', error);
    return apiError('Failed to start Twitch client', { status: 500, code: 'INTERNAL_ERROR' });
  }
}