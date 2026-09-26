import { apiOk } from '@/lib/api-response';
import { getSpotlightControlState } from '@/services/lounge-player-control';

export async function GET() {
  return apiOk(getSpotlightControlState());
}
