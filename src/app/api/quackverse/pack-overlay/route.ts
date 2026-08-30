import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { hasInternalServiceAccess, internalServiceHeaders } from '@/lib/internal-service-auth';
import { normalizeCardPackEvent } from '@/lib/card-pack-event';

function hasAccess(request: NextRequest) {
  return hasInternalServiceAccess(request);
}

export async function POST(request: NextRequest) {
  if (!hasAccess(request)) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  const body = await request.json().catch(() => null);
  const tenantId = String(body?.tenantId || '').trim() || undefined;
  const payload = {
    eventId: String(body?.eventId || body?.packId || '').trim() || `quackverse-${Date.now()}`,
    pack: Array.isArray(body?.pack) ? body.pack : [],
    setName: String(body?.setName || 'Quackverse').trim() || 'Quackverse',
    username: String(body?.username || 'player').trim() || 'player',
    source: 'quackverse',
    packImageUrl: String(body?.packImageUrl || '').trim(),
  };

  if (payload.pack.length === 0) {
    return apiError('pack is required', { status: 400, code: 'INVALID_BODY' });
  }
  if (!tenantId) {
    return apiError('tenantId is required', { status: 400, code: 'INVALID_BODY' });
  }

  const canonical = normalizeCardPackEvent(payload);
  const wsPort = process.env.WS_PORT || process.env.NEXT_PUBLIC_STREAMWEAVE_WS_PORT || '8090';
  const response = await fetch(`http://127.0.0.1:${wsPort}/api/overlay/broadcast`, {
    method: 'POST',
    headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      tenantId,
      messages: [
        { type: 'card-pack-opened', payload: canonical },
        // Keep both legacy names during the live migration so existing browser sources do not break.
        { type: 'pokemon-pack-opened', payload: { ...payload, game: 'quackverse' } },
        { type: 'quackverse-pack-opened', payload },
      ],
    }),
  });
  const broadcastResult = await response.json().catch(() => null);
  if (!response.ok) {
    return apiError(broadcastResult?.error || 'Overlay broadcast failed', {
      status: response.status,
      code: 'OVERLAY_BROADCAST_FAILED',
    });
  }

  return apiOk({ success: true, broadcast: true, tenantId, delivered: Number(broadcastResult?.delivered || 0), eventId: canonical.eventId });
}
