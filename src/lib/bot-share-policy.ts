// GLOBAL PRODUCT INVARIANT
//
// BOT SHARE IS ONLY FOR AUTONOMOUS BOT-TO-BOT TALKING.
// It must never gate a human talking to a bot, a human-issued command, a
// human-triggered action, a reply to a human, a relay explicitly requested by
// a human, persona discovery, persona invites, STT, TTS, or normal chat on any
// platform (Discord, Twitch, Kick, TikTok, HearMeOut, SPMT, or future inputs).
//
// If a request originated from a human, bot-share is irrelevant.

export const BOT_SHARE_SCOPE = 'autonomous-bot-to-bot-only' as const;

export const BOT_SHARE_NEVER_GATES = Object.freeze([
  'human-chat',
  'human-command',
  'human-trigger',
  'human-directed-relay',
  'persona-discovery',
  'persona-invite',
  'persona-conversation',
  'speech-to-text',
  'text-to-speech',
  'platform-chat',
] as const);

export function botShareAppliesToInteraction(input: {
  speakerIsBot: boolean;
  targetIsBot: boolean;
  humanDirected?: boolean;
}): boolean {
  return input.speakerIsBot && input.targetIsBot && input.humanDirected !== true;
}
