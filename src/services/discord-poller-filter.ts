type PollerDiscordContext = {
  tenantId?: string;
  username?: string;
  channelId?: string;
};

export function shouldPollerDispatchDiscordMessage(content: unknown, _context?: PollerDiscordContext): boolean {
  const text = String(content || '').trim();
  if (!text) return false;

  // Public Discord commands are handled by the webhook route so they do not
  // race the poller and get suppressed as duplicates downstream.
  if (text.startsWith('!')) return false;

  return !text.startsWith('[');
}
