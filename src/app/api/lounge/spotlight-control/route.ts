import { NextRequest } from 'next/server';
import { apiOk, apiError } from '@/lib/api-response';
import { getSpotlightControlState, requestSpotlightRestart } from '@/services/lounge-player-control';

export async function GET() {
  return apiOk(getSpotlightControlState());
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body?.action !== 'restart') return apiError('Unsupported Spotlight action', { status: 400, code: 'INVALID_ACTION' });
  return apiOk(requestSpotlightRestart());
}
