import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';

function hasAccess(request: NextRequest) {
  const secret = String(process.env.BOT_SECRET_KEY || '').trim();
  if (!secret) return false;
  const auth = request.headers.get('authorization') || '';
  const botSecret = request.headers.get('x-bot-secret') || '';
  return auth === `Bearer ${secret}` || botSecret === secret;
}

export async function POST(request: NextRequest) {
  if (!hasAccess(request)) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  const body = await request.json().catch(() => null);
  const tenantId = String(body?.tenantId || '').trim() || undefined;
  const payload = {
    pack: Array.isArray(body?.pack) ? body.pack : [],
    setName: String(body?.setName || 'Quackverse').trim() || 'Quackverse',
    username: String(body?.username || 'player').trim() || 'player',
    source: 'quackverse',
    packImageUrl: String(body?.packImageUrl || '').trim(),
  };

  if (payload.pack.length === 0) {
    return apiError('pack is required', { status: 400, code: 'INVALID_BODY' });
  }

  if (typeof (global as any).broadcast === 'function') {
    (global as any).broadcast({ type: 'pokemon-pack-opened', payload }, tenantId);
    (global as any).broadcast({ type: 'quackverse-pack-opened', payload }, tenantId);
  }

  return apiOk({ success: true, broadcast: true, tenantId: tenantId || null });
}
