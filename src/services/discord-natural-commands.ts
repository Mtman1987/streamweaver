import { detectOpenBotCommand, rewriteSpmtNamespaceCommand } from '@/services/open-bot-commands';

const TARGETED_SOCIAL_ACTIONS: Array<{ command: string; pattern: string }> = [
  { command: 'hug', pattern: 'hug' },
  { command: 'boop', pattern: 'boop' },
  { command: 'cuddle', pattern: 'cuddle' },
  { command: 'fistbump', pattern: 'fist\\s*bump' },
  { command: 'headpat', pattern: 'head\\s*pat' },
  { command: 'highfive', pattern: 'high\\s*five' },
  { command: 'love', pattern: 'love' },
  { command: 'tickle', pattern: 'tickle' },
];

function normalize(message: string): string {
  return String(message || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTarget(originalMessage: string): string {
  const discordMentions = Array.from(String(originalMessage || '').matchAll(/<@!?\d{15,24}>/g));
  if (discordMentions.length) return discordMentions[discordMentions.length - 1][0];

  const namedMentions = Array.from(String(originalMessage || '').matchAll(/@[a-z0-9_][a-z0-9_.-]{1,49}/gi));
  return namedMentions.length ? namedMentions[namedMentions.length - 1][0] : '';
}

function withTarget(command: string, originalMessage: string): string {
  const target = extractTarget(originalMessage);
  return target ? `!${command} ${target}` : `!${command}`;
}

function cleanArgument(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[?.!]+$/g, '')
    .trim();
}

function detectLeaderboardCommand(normalized: string): string | null {
  if (/\bchat[\s-]?tag\b/.test(normalized)) return null;
  const asksForBoard = /\b(?:leaderboard|leaders|rankings?|top\s+(?:ten|10|players?|members?|users?))\b/.test(normalized);
  if (!asksForBoard) return null;
  if (/\b(?:points?|xp)\b/.test(normalized)) return '!pleader';
  if (/\bwatch\s*time\b/.test(normalized)) return '!wleader';
  if (/\b(?:pokemon\s+)?cards?\b/.test(normalized)) return '!cleader';
  if (/\bbadges?\b/.test(normalized)) return '!bleader';
  if (/\b(?:show|open|view|display|give me|what(?:'s| is))\b/.test(normalized)) return '!leaderboard';
  return null;
}

/**
 * Maps high-confidence natural-language requests onto the existing native
 * Discord command dispatcher. This intentionally avoids moderator toggles and
 * other ambiguous writes; their explicit !commands remain authoritative.
 */
export function detectDiscordNaturalCommand(message: string, originalMessage = message): string | null {
  const raw = String(message || '').trim();
  if (!raw || raw.startsWith('!')) return null;

  const normalized = normalize(raw);

  // Explicit SPMT namespace lookups in the shared read-only catalog keep their
  // dedicated data sources. Other documented SPMT commands reuse the native
  // Discord dispatcher instead of falling through to conversational AI.
  if (/^@?spmt(?:\s|[:,-])/.test(normalized)) {
    if (detectOpenBotCommand(raw)) return null;
    return rewriteSpmtNamespaceCommand(raw);
  }

  const leaderboard = detectLeaderboardCommand(normalized);
  if (leaderboard) return leaderboard;

  // Preserve the safe shared command catalog (ChatTag, live members, apps,
  // HearMeOut status, and shared help) before considering native commands.
  if (detectOpenBotCommand(raw)) return null;

  if (/\b(?:show|open|list|display|view)\b.*\b(?:admin|moderator|mod) commands?\b/.test(normalized)) return '!admin';
  if (
    /\b(?:show|open|list|display|view|give me)\b.*\b(?:all\s+)?(?:discord\s+)?commands?\b/.test(normalized) ||
    /\bwhat commands (?:can|may|do) (?:i|we) (?:use|run|have)\b/.test(normalized)
  ) return '!commands';

  if (
    /\bhow many points do (?:i|we) have\b/.test(normalized) ||
    /\b(?:what(?:'s| is)|show|check|display|tell me)\b.*\b(?:my\s+)?points?(?:\s+balance)?\b/.test(normalized) ||
    /\bpoints? balance\b/.test(normalized)
  ) {
    const ownBalance = /\b(?:my|our)\b/.test(normalized) || /\bdo (?:i|we) have\b/.test(normalized);
    return ownBalance ? '!points' : withTarget('points', originalMessage);
  }

  if (
    /\b(?:what(?:'s| is)|show|check|display|tell me)\b.*\b(?:my\s+)?watch\s*time\b/.test(normalized) ||
    /\bhow (?:long|much time)\b.*\b(?:have i|i have|watched|watching)\b/.test(normalized)
  ) return '!watchtime';

  if (/\b(?:show|open|view|display|check)\b.*\b(?:my\s+|global\s+)?(?:profile|user stats)\b/.test(normalized)) {
    return /\bmy\b/.test(normalized) ? '!leader' : withTarget('leader', originalMessage);
  }
  if (/\b(?:what(?:'s| is)|show|tell me)\b.*\b(?:the\s+)?(?:current\s+)?time\b|\bwhat time is it\b/.test(normalized)) return '!time';
  if (/\bstream uptime\b|\bhow long (?:has|is) (?:the )?stream (?:been )?(?:live|online|running)\b|\bhow long have you been live\b/.test(normalized)) return '!uptime';
  if (/\bhow many followers\b|\b(?:show|check|tell me)\b.*\bfollower count\b/.test(normalized)) return '!followers';
  if (/\b(?:show|check|display|tell me)\b.*\b(?:stream|channel|bot) stats\b/.test(normalized)) return '!stats';

  const pack = raw.match(/\b(?:open|buy|get|draw)\s+(?:me\s+)?(?:a\s+)?(?:pokemon\s+)?pack\b(?:\s+(?:from|for|set)\s+(.+))?\s*[?.!]*$/i);
  if (pack) {
    const setName = cleanArgument(pack[1] || '');
    return setName ? `!pack ${setName}` : '!pack';
  }
  if (/\b(?:show|open|view|display|list)\b.*\b(?:my\s+)?(?:pokemon\s+|card\s+)?collections?\b/.test(normalized)) return '!collection';
  if (/\b(?:show|open|view|display)\b.*\b(?:my\s+)?(?:pokemon\s+)?deck\b/.test(normalized)) return '!deck';
  if (/\b(?:show|open|view|display)\b.*\b(?:my\s+)?eevee\b/.test(normalized)) return '!eevee';
  const showCard = raw.match(/\b(?:show|view|find|display)\s+(?:me\s+)?(?:the\s+)?(?:pokemon\s+)?card\s+(.+?)\s*[?.!]*$/i);
  if (showCard) {
    const card = cleanArgument(showCard[1]);
    if (card) return `!show ${card}`;
  }

  const target = extractTarget(originalMessage);
  if (target) {
    for (const action of TARGETED_SOCIAL_ACTIONS) {
      const actionFirst = new RegExp(`(?:^|<@!?\\d{15,24}>\\s+|^[a-z0-9_-]+[,:]\\s+|\\b(?:please|can you|could you|would you)\\s+)${action.pattern}\\b[\\s,:-]*(?:<@!?\\d{15,24}>|@[a-z0-9_][a-z0-9_.-]{1,49})`, 'i');
      const targetFirst = new RegExp(`(?:<@!?\\d{15,24}>|@[a-z0-9_][a-z0-9_.-]{1,49})[\\s,:-]+(?:a\\s+)?${action.pattern}\\b`, 'i');
      const giveAction = new RegExp(`\\bgive\\s+(?:<@!?\\d{15,24}>|@[a-z0-9_][a-z0-9_.-]{1,49})\\s+(?:a\\s+)?${action.pattern}\\b`, 'i');
      if (actionFirst.test(originalMessage) || targetFirst.test(originalMessage) || giveAction.test(originalMessage)) {
        return `!${action.command} ${target}`;
      }
    }

    if (/\b(?:shout\s*out|shoutout)\b/i.test(raw) || /\bgive\b.*\ba shoutout\b/i.test(raw)) return `!so ${target}`;
    if (/\b(?:start|open|make|request)\b.*\btrade\b|\btrade with\b/i.test(raw)) return `!trade ${target}`;

    const givePoints = raw.match(/\bgive\s+(?:<@!?\d{15,24}>|@[a-z0-9_][a-z0-9_.-]{1,49})\s+([0-9][0-9,]*)\s+points?\b|\bgive\s+([0-9][0-9,]*)\s+points?\s+to\s+(?:<@!?\d{15,24}>|@[a-z0-9_][a-z0-9_.-]{1,49})\b/i);
    if (givePoints) return `!givepoints ${target} ${(givePoints[1] || givePoints[2]).replace(/,/g, '')}`;

    const stealPoints = raw.match(/\bsteal\s+([0-9][0-9,]*)\s+points?\s+from\s+(?:<@!?\d{15,24}>|@[a-z0-9_][a-z0-9_.-]{1,49})\b/i);
    if (stealPoints) return `!stealpoints ${target} ${stealPoints[1].replace(/,/g, '')}`;
  }

  const offer = raw.match(/\b(?:offer|put up)\s+(?:the\s+)?card\s+(.+?)\s*[?.!]*$/i);
  if (offer) {
    const card = cleanArgument(offer[1]);
    if (card) return `!offer ${card}`;
  }

  if (/\b(?:flip|toss)\s+(?:a\s+)?coin\b|\bcoin\s*flip\b/.test(normalized)) return '!coinflip';
  const roll = normalized.match(/\broll\s+(?:the\s+)?(?:dice|die)(?:\s+(?:for|with)\s+([0-9][0-9,]*))?\b/);
  if (roll) return roll[1] ? `!roll ${roll[1].replace(/,/g, '')}` : '!roll';
  const gamble = normalized.match(/\b(?:gamble|bet|wager)\s+([0-9][0-9,]*|all|half)\b/);
  if (gamble) return `!gamble ${gamble[1].replace(/,/g, '')}`;
  const double = normalized.match(/\b(?:double|double down)(?:\s+(?:my\s+bet|on))?\s+([0-9][0-9,]*|all|half)\b/);
  if (double) return `!double ${double[1].replace(/,/g, '')}`;

  if (/\b(?:please\s+)?dance(?:\s+(?:for|with)\s+us)?[?.!]*$/.test(normalized) || /\bcan you dance[?.!]*$/.test(normalized)) return '!dance';
  if (/\b(?:please\s+)?hover[?.!]*$/.test(normalized) || /\bcan you hover[?.!]*$/.test(normalized)) return '!hover';
  if (/\b(?:i am|i'm|im|going to|time to)\s+lurk(?:ing)?\b|\blurk mode\b/.test(normalized)) return '!lurk';
  if (/\b(?:back from|done|stop|finished)\s+lurk(?:ing)?\b|\bunlurk\b/.test(normalized)) return '!unlurk';

  return null;
}
