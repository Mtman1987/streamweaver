const DIRECT_ALIASES: Record<string, string> = {
  commands: 'commands',
  points: 'points',
  watchtime: 'watchtime',
  followers: 'followers',
  uptime: 'uptime',
  stats: 'stats',
  time: 'time',
  lurk: 'lurk',
  unlurk: 'unlurk',
  hug: 'hug',
  boop: 'boop',
  cuddle: 'cuddle',
  fistbump: 'fistbump',
  headpat: 'headpat',
  highfive: 'highfive',
  love: 'love',
  tickle: 'tickle',
  dance: 'dance',
  hover: 'hover',
  shoutout: 'so',
  so: 'so',
  image: 'img',
  img: 'img',
  translate: 't',
  t: 't',
  say: 'say',
  checkin: 'checkin',
  partner: 'partner',
  crew: 'crew',
  crewcheckin: 'crewcheckin',
  modcheckin: 'modcheckin',
  spacemountain: 'spacemountain',
  space: 'space',
  mtfixit: 'mtfixit',
};

const MEDIA_ALIASES: Record<string, string> = {
  song: 'sr',
  music: 'sr',
  request: 'sr',
  movie: 'wr',
  watch: 'wr',
  now: 'np',
  nowplaying: 'np',
  status: 'np',
  play: 'play',
  pause: 'pause',
  stop: 'stop',
  skip: 'skip',
  next: 'next',
  clear: 'clear',
  unmute: 'unmute',
  bump: 'bump',
  votebump: 'votebump',
  volume: 'volume',
  vol: 'vol',
};

const POKEMON_ALIASES: Record<string, string> = {
  pack: 'pack',
  collection: 'collection',
  collections: 'collections',
  pokedex: 'pokedex',
  show: 'show',
  deck: 'deck',
  setdeck: 'setdeck',
  trade: 'trade',
  offer: 'offer',
  accept: 'accept',
  cancel: 'cancel',
  swap: 'swap',
  challenge: 'challenge',
  attack: 'attack',
  switch: 'switch',
  gymteam: 'gymteam',
};

const ECONOMY_ALIASES: Record<string, string> = {
  gamble: 'gamble',
  roll: 'roll',
  double: 'double',
  coinflip: 'coinflip',
  givepoints: 'givepoints',
  stealpoints: 'stealpoints',
};

/**
 * Normalize canonical non-game SPMT commands onto the existing proven legacy
 * handlers. Nebula owns unqualified game-shaped roots, so ambiguous words such
 * as stop, pack, card, show, view, join and leave are never rewritten here.
 */
export function rewriteSpmtLegacyAlias(messageValue: unknown): string | null {
  const message = String(messageValue || '').trim();
  const match = message.match(/^@?spmt(?:\s+|[:,-]\s*)(.+)$/i);
  if (!match) return null;
  const payload = match[1].trim();
  const parts = payload.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  const root = parts[0].toLowerCase();
  const rest = parts.slice(1);

  const direct = DIRECT_ALIASES[root];
  if (direct) return `!${direct}${rest.length ? ` ${rest.join(' ')}` : ''}`;

  if (root === 'media' || root === 'hmo' || root === 'hearmeout') {
    const action = String(rest.shift() || 'now').toLowerCase();
    const legacy = MEDIA_ALIASES[action];
    if (!legacy) return null;
    return `!${legacy}${rest.length ? ` ${rest.join(' ')}` : ''}`;
  }

  if (root === 'pokemon' || root === 'poke') {
    const action = String(rest.shift() || 'collection').toLowerCase();
    const legacy = POKEMON_ALIASES[action];
    if (!legacy) return null;
    return `!${legacy}${rest.length ? ` ${rest.join(' ')}` : ''}`;
  }

  if (root === 'economy' || root === 'points-game') {
    const action = String(rest.shift() || '').toLowerCase();
    const legacy = ECONOMY_ALIASES[action];
    if (!legacy) return null;
    return `!${legacy}${rest.length ? ` ${rest.join(' ')}` : ''}`;
  }

  return null;
}
