import { detectMtFixItIntent, hasPendingMtSupportRequest } from './mt-support-report';

type PollerDiscordContext = {
  tenantId?: string;
  username?: string;
  channelId?: string;
};

export function shouldPollerDispatchDiscordMessage(content: unknown, context?: PollerDiscordContext): boolean {
  const text = String(content || '').trim();
  if (!text) return false;

  // Public Discord commands should be handled by the webhook route so they
  // don't race the poller and get suppressed as duplicates downstream.
  if (text.startsWith('!')) return false;

  if (detectMtFixItIntent(text).matched) return false;

  if (context?.username && hasPendingMtSupportRequest({
    platform: 'discord',
    tenantId: context.tenantId,
    username: context.username,
    channelId: context.channelId,
  })) {
    return false;
  }

  return !text.startsWith('[');
}
