import { getConfiguredAppUrl } from '../lib/runtime-origin';
import { sendChatMessage } from './twitch';

const KICK_REAUTH_NOTICE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const lastKickReauthNotice = new Map<string, number>();

function noticeKey(tenantId: string, channelName?: string) {
  return `${tenantId}:${String(channelName || 'kick').toLowerCase()}`;
}

export async function sendKickReauthNotice(input: {
  tenantId?: string;
  channelName?: string;
  reason?: string;
}): Promise<void> {
  const tenantId = String(input.tenantId || '').trim();
  if (!tenantId || tenantId === 'global' || tenantId.startsWith('kick_community_')) return;

  const key = noticeKey(tenantId, input.channelName);
  const now = Date.now();
  if (now - (lastKickReauthNotice.get(key) || 0) < KICK_REAUTH_NOTICE_INTERVAL_MS) return;

  const appUrl = getConfiguredAppUrl();
  const channel = input.channelName ? ` for ${input.channelName}` : '';
  const reason = input.reason ? ` (${input.reason})` : '';
  const message = `StreamWeaver could not connect Kick chat${channel}${reason}. Please re-authorize Kick Broadcaster here: ${appUrl}/integrations`;

  try {
    await sendChatMessage(message, 'bot', undefined, tenantId);
    lastKickReauthNotice.set(key, now);
  } catch (error) {
    console.warn('[Kick] Could not send tenant reauthorization notice:', error);
  }

  if (typeof (global as any).broadcast === 'function') {
    (global as any).broadcast({
      type: 'kick-status',
      payload: {
        connected: false,
        channel: input.channelName || null,
        error: 'reauthorization_required',
        message,
      },
    }, tenantId);
  }
}
