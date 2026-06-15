const MAX_TRACKED_MESSAGE_IDS = 2000;

const globalState = global as typeof globalThis & {
  __streamweaverDiscordHandledMessageIds?: Set<string>;
};

function getHandledMessageIds(): Set<string> {
  if (!globalState.__streamweaverDiscordHandledMessageIds) {
    globalState.__streamweaverDiscordHandledMessageIds = new Set<string>();
  }
  return globalState.__streamweaverDiscordHandledMessageIds;
}

function normalizeMessageKey(messageId?: string | null, channelId?: string | null): string {
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedMessageId) return '';
  const normalizedChannelId = String(channelId || '').trim();
  return normalizedChannelId ? `${normalizedChannelId}:${normalizedMessageId}` : normalizedMessageId;
}

type DiscordMessageDedupeInput = {
  messageId?: string | null;
  channelId?: string | null;
  userId?: string | null;
  username?: string | null;
  content?: string | null;
  createdAt?: string | null;
};

function normalizeSignatureKey(input: DiscordMessageDedupeInput): string {
  const channelId = String(input.channelId || '').trim();
  const actor = String(input.userId || input.username || '').trim().toLowerCase();
  const content = String(input.content || '').trim().replace(/\s+/g, ' ');
  const createdAt = String(input.createdAt || '').trim();
  if (!channelId || !actor || !content || !createdAt) return '';
  return `sig:${channelId}:${actor}:${createdAt}:${content}`;
}

function trimHandledKeys(handled: Set<string>): void {
  if (handled.size <= MAX_TRACKED_MESSAGE_IDS) return;

  const overflow = handled.size - MAX_TRACKED_MESSAGE_IDS;
  let removed = 0;
  for (const existingKey of handled) {
    handled.delete(existingKey);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export function registerHandledDiscordMessage(inputOrMessageId?: DiscordMessageDedupeInput | string | null, channelId?: string | null): boolean {
  const input: DiscordMessageDedupeInput =
    typeof inputOrMessageId === 'object' && inputOrMessageId !== null
      ? inputOrMessageId
      : { messageId: inputOrMessageId, channelId };

  const keys = [
    normalizeMessageKey(input.messageId, input.channelId),
    normalizeSignatureKey(input),
  ].filter(Boolean);

  if (keys.length === 0) return true;

  const handled = getHandledMessageIds();
  for (const key of keys) {
    if (handled.has(key)) return false;
  }

  for (const key of keys) {
    handled.add(key);
  }
  trimHandledKeys(handled);

  return true;
}
