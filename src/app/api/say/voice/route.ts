import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getSpmtDiscordIdentity } from '@/lib/spmt-userinfo';
import { discordSayCapture } from '@/services/discord-say-capture';
export const dynamic = 'force-dynamic';
async function run(request: NextRequest, action: string, id?: string) {
  if (!getTenantFromRequest(request)) return apiError('Sign in to use speech-to-chat.', { status: 401 });
  const identity = await getSpmtDiscordIdentity(request).catch(() => null);
  if (!identity) return action === 'probe' ? apiOk({ inVoice: false }) : apiError('Link your Discord account to use the voice listener.', { status: 401 });
  try { return apiOk(await discordSayCapture(identity.discordUserId, action, id)); }
  catch (error) { return apiError(error instanceof Error ? error.message : 'Discord listener failed.', { status: 502 }); }
}
export async function GET(request: NextRequest) { return run(request, 'probe'); }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || !['start', 'stop', 'cancel', 'result'].includes(body.action) || (body.action !== 'start' && !/^[0-9a-f-]{36}$/i.test(body.id || ''))) return apiError('Invalid voice request.', { status: 400 });
  return run(request, body.action, body.id);
}
