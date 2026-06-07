const SPOKEN_EMOTE_TOKENS = new Set([
  '4head',
  'biblethump',
  'bleedpurple',
  'coolstorybob',
  'cmonbruh',
  'dansgame',
  'failfish',
  'heyguys',
  'kappa',
  'kappapride',
  'kreygasm',
  'lul',
  'monka',
  'monkagiga',
  'monkahmm',
  'monkas',
  'monkaw',
  'notlikethis',
  'omegalul',
  'pepehands',
  'pepelaugh',
  'pjsalt',
  'pog',
  'pogchamp',
  'poggers',
  'residentsleeper',
  'seemsgood',
  'swiftrage',
  'trihard',
  'vohiyo',
  'wutface',
]);

const DISCORD_CUSTOM_EMOTE_RE = /<a?:[A-Za-z0-9_~]+:\d+>/g;
const SHORTCODE_EMOTE_RE = /:[A-Za-z0-9_+-]{2,}:/g;
const UNICODE_EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0E\uFE0F\u200D]/gu;
const EMOTE_TOKEN_RE = /\b[A-Za-z0-9_]{2,}\b/g;

export function normalizeTextForTTS(text: string): string {
  return text
    .replace(/\bMt\./g, 'M.T.')
    .replace(DISCORD_CUSTOM_EMOTE_RE, ' ')
    .replace(SHORTCODE_EMOTE_RE, ' ')
    .replace(UNICODE_EMOJI_RE, ' ')
    .replace(EMOTE_TOKEN_RE, (token) => (
      SPOKEN_EMOTE_TOKENS.has(token.toLowerCase()) ? ' ' : token
    ))
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
