import { ensureValidToken, getStoredTokens } from '@/lib/token-utils.server';
import { SPACEMOUNTAIN_SYSTEM_TENANT_ID } from '@/lib/tenant';

const LOUNGE = 'spacemountainlive';
const STELLA = 'stellabot87';
const REQUIRED_SCOPE = 'moderator:manage:shoutouts';
const GLOBAL_COOLDOWN_MS = 2 * 60_000;
const TARGET_COOLDOWN_MS = 60 * 60_000;

type Credential = { token: string; clientId: string };
type ShoutoutResult = {
  status: string; channel: string; destination: string; sender: string;
  retryAfterSeconds?: number;
  messageId?: string;
};

// All tenants share Stella's grant, but the destination is always the Lounge.
// Neither the command author's identity nor the source tenant selects a token.
async function getStellaCredential(): Promise<Credential> {
  const tokens = await getStoredTokens(SPACEMOUNTAIN_SYSTEM_TENANT_ID);
  if (!tokens || tokens.botUsername?.toLowerCase() !== STELLA) throw Error('Stella connection required');
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID || '';
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw Error('Twitch connection unavailable');
  const token = await ensureValidToken(clientId, clientSecret, 'bot', tokens, SPACEMOUNTAIN_SYSTEM_TENANT_ID);
  return { token, clientId };
}

export function createStellaCheckinShoutout({
  getCredential = getStellaCredential,
  fetchImpl = fetch,
  now = Date.now,
}: {
  getCredential?: () => Promise<Credential>;
  fetchImpl?: typeof fetch;
  now?: () => number;
} = {}) {
  let lastSentAt = -Infinity;
  const targets = new Map<string, number>();
  let tail: Promise<void> = Promise.resolve();

  async function deliver(sourceChannel: string, kind: 'native' | 'chat' = 'native'): Promise<ShoutoutResult> {
    const channel = String(sourceChannel || '').trim().replace(/^#/, '').toLowerCase();
    const result = (status: string, retryAfterSeconds?: number): ShoutoutResult => ({
      status, channel, destination: LOUNGE, sender: STELLA,
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    });
    if (!/^[a-z0-9_]{1,25}$/.test(channel)) return result('invalid-channel');
    if (channel === LOUNGE) return result('self-shoutout');
    const timestamp = now();
    for (const [target, sentAt] of targets) if (timestamp - sentAt >= TARGET_COOLDOWN_MS) targets.delete(target);
    const nextAllowed = Math.max(lastSentAt + GLOBAL_COOLDOWN_MS, (targets.get(channel) ?? -Infinity) + TARGET_COOLDOWN_MS);
    if (kind === 'native' && nextAllowed > timestamp) return result('cooldown', Math.ceil((nextAllowed - timestamp) / 1000));

    try {
      const { token, clientId } = await getCredential();
      const validation = await fetchImpl('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(8_000),
      });
      const identity = validation.ok ? await validation.json() : null;
      if (!identity) return result('authorization-required');
      if (identity.login !== STELLA || !identity.user_id || identity.client_id !== clientId) return result('wrong-stella-account');
      const requiredScope = kind === 'chat' ? 'user:write:chat' : REQUIRED_SCOPE;
      if (!Array.isArray(identity.scopes) || !identity.scopes.includes(requiredScope)) {
        return result(kind === 'chat' ? 'missing-chat-permission' : 'missing-shoutout-permission');
      }

      const headers = { 'Client-ID': clientId, Authorization: `Bearer ${token}` };
      const users = await fetchImpl(`https://api.twitch.tv/helix/users?login=${LOUNGE}&login=${channel}`, {
        headers, signal: AbortSignal.timeout(8_000),
      });
      if (!users.ok) return result('unavailable');
      const body = await users.json();
      const accounts: { id: string; login: string }[] = Array.isArray(body.data) ? body.data : [];
      const broadcaster = accounts.find(user => user.login === LOUNGE);
      const target = accounts.find(user => user.login === channel);
      if (!broadcaster?.id || !target?.id) return result('channel-not-found');

      if (kind === 'chat') {
        const response = await fetchImpl('https://api.twitch.tv/helix/chat/messages', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            broadcaster_id: broadcaster.id,
            sender_id: String(identity.user_id),
            message: `!so ${channel}`,
          }),
          signal: AbortSignal.timeout(8_000),
        });
        const payload = await response.json().catch(() => null);
        const receipt = payload?.data?.[0];
        if (response.ok && receipt?.is_sent === true && typeof receipt.message_id === 'string' && receipt.message_id) {
          return { ...result('sent'), messageId: receipt.message_id };
        }
        if (response.status === 401 || response.status === 403) return result('authorization-required');
        if (response.status === 429) return result('rate-limited');
        return result(response.ok ? 'not-sent' : 'unavailable');
      }

      const query = new URLSearchParams({
        from_broadcaster_id: broadcaster.id,
        to_broadcaster_id: target.id,
        moderator_id: String(identity.user_id),
      });
      const response = await fetchImpl(`https://api.twitch.tv/helix/chat/shoutouts?${query}`, {
        method: 'POST', headers, signal: AbortSignal.timeout(8_000),
      });
      if (response.status === 204) {
        lastSentAt = now();
        targets.set(channel, lastSentAt);
        return result('sent');
      }
      if (response.status === 429) return result('cooldown');
      if (response.status === 401 || response.status === 403) return result('authorization-required');
      if (response.status === 400) return result('not-eligible');
      return result('unavailable');
    } catch {
      // Never expose credentials or raw Twitch responses in logs or chat.
      return result('unavailable');
    }
  }

  return {
    // A chat command has its own Twitch limits; native shoutout cooldowns do
    // not prevent it. The check-in route's durable claim prevents duplicates.
    sendChatCommand: (channel: string) => deliver(channel, 'chat'),
    send(channel: string) {
      const pending = tail.then(() => deliver(channel));
      tail = pending.then(() => {}, () => {});
      return pending;
    },
  };
}

const stella = createStellaCheckinShoutout();
export const sendStellaCheckinShoutout = (channel: string) => stella.send(channel);
export const sendStellaCheckinChatShoutout = (channel: string) => stella.sendChatCommand(channel);

export function formatCheckinChatShoutoutReply(result: ShoutoutResult): string {
  if (result.status === 'sent' || result.status === 'self-shoutout') return '';
  return `Stella could not post !so for #${result.channel} in the Lounge.`;
}

export function formatCheckinShoutoutReply(result: ShoutoutResult): string {
  const target = `#${result.channel}`;
  if (result.status === 'sent') return `Stella sent the native Twitch /shoutout for ${target} in the Lounge.`;
  if (result.status === 'self-shoutout') return '';
  if (result.status === 'cooldown') return `Lounge shoutout for ${target}: Twitch cooldown${result.retryAfterSeconds ? ` (${result.retryAfterSeconds}s)` : ''}.`;
  if (['missing-shoutout-permission', 'authorization-required', 'wrong-stella-account'].includes(result.status)) {
    return `Lounge shoutout needs Stella's Twitch shoutout authorization and moderator access.`;
  }
  if (result.status === 'not-eligible') return `Twitch could not send the Lounge shoutout for ${target}; the Lounge must be live with viewers and the target eligible.`;
  return `Lounge shoutout for ${target} is unavailable right now.`;
}
