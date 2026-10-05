// Only a real Twitch receipt for Stella's Lounge !so may pass bot-loop guards.
// Local tmi.js echoes have no Twitch message ID and must remain ignored.
export function isConfirmedLoungeStellaShoutout(input: {
  tenantId?: string;
  channel: string;
  tags: Record<string, any>;
  message: string;
}): boolean {
  return input.tenantId === 'spacemountainlive'
    && input.channel.replace(/^#/, '').toLowerCase() === 'spacemountainlive'
    && String(input.tags.username || '').toLowerCase() === 'stellabot87'
    && Boolean(String(input.tags.id || '').trim())
    && /^!so [a-z0-9_]{1,25}$/i.test(input.message.trim());
}
