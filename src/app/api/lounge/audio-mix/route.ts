import { getLoungeAudioMix } from '@/services/lounge-audio-mix';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await getLoungeAudioMix(), {
    headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}
