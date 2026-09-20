const ALWAYS_SPOKEN_TWITCH_BOTS = new Set(['athenabot87', 'stellabot87']);

export function isAlwaysSpokenTwitchBot(username: string): boolean {
  return ALWAYS_SPOKEN_TWITCH_BOTS.has(username.toLowerCase());
}

export function shouldQueueTwitchSay(input: {
  tenantId?: string;
  username: string;
  isCommand: boolean;
  isBotMessage: boolean;
  isKnownAutomationBotMessage: boolean;
}): boolean {
  if (input.isCommand) return false;
  if (!input.isBotMessage && !input.isKnownAutomationBotMessage) return true;

  return isAlwaysSpokenTwitchBot(input.username);
}
