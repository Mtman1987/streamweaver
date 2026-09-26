import type { SharedChatEventV1 } from '../contracts/shared-chat-event';

// Chat replay is already written by the Twitch listener before it dispatches
// commands. A recent message proves participation even without chatters OAuth.
export const BRB_CHAT_ACTIVITY_WINDOW_MS = 45 * 60_000;

export function recentTwitchChatters(
  events: Pick<SharedChatEventV1, 'platform' | 'sourceName' | 'sender' | 'receivedTimestamp' | 'meta'>[],
  channel: string,
  now = Date.now(),
): string[] {
  const users = new Set<string>();
  const source = channel.trim().replace(/^#/, '').toLowerCase();
  for (const event of events) {
    if (event.platform !== 'twitch' || event.sourceName?.toLowerCase() !== source) continue;
    if (event.meta?.self === true || event.sender.roles.includes('bot')) continue;
    const time = Date.parse(event.receivedTimestamp);
    if (!Number.isFinite(time) || time > now + 60_000 || now - time > BRB_CHAT_ACTIVITY_WINDOW_MS) continue;
    const login = event.sender.login?.toLowerCase();
    if (login && /^[a-z0-9_]{3,25}$/.test(login)) users.add(login);
  }
  return [...users];
}
