import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { appendPrivateChatMessages } from '@/lib/private-chat-store';
import { appendPublicChatMessages } from '@/lib/public-chat-store';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  normalizeSocialStreamMessage,
  normalizeSocialStreamSharedChatEvent,
  toPrivateChatMessage,
  toPublicChatMessage,
} from '@/lib/social-stream-normalizer';
import { recordSharedChatDeadLetter, recordSharedChatEvent } from '@/services/shared-chat-ingestion';

function hasBridgeAccess(request: NextRequest): boolean {
  const configuredToken = String(process.env.SOCIAL_STREAM_BRIDGE_TOKEN || process.env.BOT_SECRET_KEY || '').trim();
  if (!configuredToken) {
    const host = request.headers.get('host') || '';
    return host.startsWith('127.0.0.1') || host.startsWith('localhost');
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  const headerToken = request.headers.get('x-streamweaver-bridge-token') || '';
  const queryToken = request.nextUrl.searchParams.get('token') || '';
  return [bearer, headerToken, queryToken].some((token) => token && token === configuredToken);
}

function isPrivateTarget(request: NextRequest, body: Record<string, unknown>): boolean {
  const visibility = String(body.visibility || body.scope || request.nextUrl.searchParams.get('visibility') || '').toLowerCase();
  return visibility === 'private' || body.private === true || body.isPrivate === true;
}

export async function POST(request: NextRequest) {
  try {
    if (!hasBridgeAccess(request)) {
      return apiError('Unauthorized Social Stream bridge request', { status: 401, code: 'UNAUTHORIZED' });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid Social Stream payload', { status: 400, code: 'INVALID_BODY' });
    }

    const normalized = normalizeSocialStreamMessage(body);
    if (!normalized) {
      return apiError('No chat message or media found in Social Stream payload', { status: 400, code: 'NO_MESSAGE' });
    }

    const session = getTenantFromRequest(request);
    const payloadTenant = typeof (body as Record<string, unknown>).tenantId === 'string'
      ? String((body as Record<string, unknown>).tenantId).trim()
      : '';
    const headerTenant = String(request.headers.get('x-streamweaver-tenant-id') || '').trim();
    const tenantId = session?.tenantId || headerTenant || payloadTenant;
    if (!tenantId) {
      return apiError('A tenant id is required for Social Stream ingestion', { status: 400, code: 'TENANT_REQUIRED' });
    }

    const sharedEvent = normalizeSocialStreamSharedChatEvent(body, tenantId);
    if (!sharedEvent) {
      await recordSharedChatDeadLetter({
        tenantId,
        source: 'social-stream',
        reason: 'Payload could not be normalized as SharedChatEventV1',
        payload: body,
      });
      return apiError('Social Stream payload could not be normalized', { status: 400, code: 'INVALID_EVENT' });
    }
    await recordSharedChatEvent(sharedEvent);

    if (isPrivateTarget(request, body as Record<string, unknown>)) {
      await appendPrivateChatMessages([toPrivateChatMessage(normalized)], 100, tenantId);
      return apiOk({ stored: true, replayStored: true, target: 'private', source: normalized.source, tenantId, eventId: sharedEvent.eventId });
    }

    await appendPublicChatMessages([toPublicChatMessage(normalized)], 100, tenantId);
    return apiOk({ stored: true, replayStored: true, target: 'public', source: normalized.source, tenantId, eventId: sharedEvent.eventId });
  } catch (error) {
    console.error('[Social Stream Bridge] Failed to ingest payload:', error);
    return apiError('Failed to ingest Social Stream payload', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
