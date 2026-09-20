const ALWAYS_SPOKEN_TWITCH_BOTS = new Set(['athenabot87', 'stellabot87']);
export const ATHENA_TWITCH_TTS_VOICE = 'deepgram:aura-2:athena';

export function isAlwaysSpokenTwitchBot(username: string): boolean {
  return ALWAYS_SPOKEN_TWITCH_BOTS.has(username.toLowerCase());
}

export function getTwitchBotTtsVoice(username: string): string | undefined {
  return username.toLowerCase() === 'athenabot87' ? ATHENA_TWITCH_TTS_VOICE : undefined;
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
