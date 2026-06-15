type CatalogOptions = {
  isMod: boolean;
};

const DISCORD_FUN_COMMANDS = [
  '!hug', '!boop', '!cuddle', '!dance', '!fistbump', '!headpat', '!highfive', '!love', '!tickle', '!hover',
  '!lurk', '!unlurk', '!hydrate', '!stretch', '!yes', '!yup', '!no',
];

const DISCORD_LINK_COMMANDS = [
  '!discord', '!instagram', '!merch', '!tiktok', '!twitter', '!webpage', '!youtube',
];

const DISCORD_INFO_COMMANDS = [
  '!points', '!watchtime', '!time', '!followers', '!uptime', '!stats',
];

const DISCORD_UTILITY_COMMANDS = [
  '!commands', '!so <user>', '!botshare', '!mtfixit', '!raidmessage <msg>',
];

const DISCORD_ADMIN_COMMANDS = [
  '!admin', '!ignore <user>',
  '!timeout <user> [duration] [reason]',
  '!greetingmode', '!welcomemode', '!clipmode', '!chatmode', '!athenaeverywhere',
  '!addflow <prompt>', '!approveflow <!command>', '!disableflow <!command>', '!deleteflow <!command>',
];

function commandName(label: string): string {
  return label
    .trim()
    .split(/\s+/)[0]
    .replace(/^!/, '')
    .toLowerCase();
}

export const DISCORD_ROUTED_COMMAND_NAMES = Array.from(new Set([
  ...DISCORD_FUN_COMMANDS,
  ...DISCORD_LINK_COMMANDS,
  ...DISCORD_INFO_COMMANDS,
  '!so <user>',
  '!raidmessage <msg>',
  '!greetingmode',
  '!welcomemode',
  '!clipmode',
  '!chatmode',
  '!athenaeverywhere',
  '!addflow <prompt>',
  '!approveflow <!command>',
  '!disableflow <!command>',
  '!deleteflow <!command>',
  '!timeout <user> [duration] [reason]',
  '!ignore <user>',
])).map(commandName);

export const DISCORD_UNSUPPORTED_COMMAND_MESSAGES: Record<string, string> = {
  gamble: 'Discord gambling is disabled until Discord points are wired correctly.',
  roll: 'Discord roll is disabled until Discord points are wired correctly.',
  double: 'Discord double is disabled until Discord points are wired correctly.',
  leader: 'Discord leaderboards need Discord-native point and activity data first.',
  pleader: 'Discord leaderboards need Discord-native point and activity data first.',
  wleader: 'Discord leaderboards need Discord-native point and activity data first.',
  cleader: 'Discord leaderboards need Discord-native point and activity data first.',
  bleader: 'Discord leaderboards need Discord-native point and activity data first.',
  bitsleader: 'Discord leaderboards need Discord-native point and activity data first.',
  pack: 'Discord pack commands need a Discord-specific embed and preview flow first.',
  collection: 'Discord collection commands need a Discord-specific presentation first.',
  show: 'Discord card display needs a Discord-specific presentation first.',
  trade: 'Discord trading needs a Discord-specific interaction flow first.',
  offer: 'Discord trading needs a Discord-specific interaction flow first.',
  accept: 'Discord trading needs a Discord-specific interaction flow first.',
  cancel: 'Discord trading needs a Discord-specific interaction flow first.',
  challenge: 'Discord battle commands need a Discord-specific interaction flow first.',
  attack: 'Discord battle commands need a Discord-specific interaction flow first.',
  switch: 'Discord battle commands need a Discord-specific interaction flow first.',
  setdeck: 'Discord deck commands need a Discord-specific interaction flow first.',
  deck: 'Discord deck commands need a Discord-specific interaction flow first.',
  eevee: 'Discord pack commands need a Discord-specific embed and preview flow first.',
  followage: 'Discord followage is Twitch-specific and is not supported here.',
  followed: 'Discord followed status needs a Twitch identity mapping first.',
  clip: 'Discord clip needs explicit tenant targeting or a Discord-native clip design first.',
  brb: 'BRB controls are Twitch/stream-state specific and are not supported in Discord.',
  back: 'BRB controls are Twitch/stream-state specific and are not supported in Discord.',
  setgame: 'Setting stream game from Discord is disabled here.',
  settitle: 'Setting stream title from Discord is disabled here.',
};

export function buildDiscordCommandsSummary(): string {
  return [
    `Discord commands`,
    `Fun: ${DISCORD_FUN_COMMANDS.join(', ')}`,
    `Links: ${DISCORD_LINK_COMMANDS.join(', ')}`,
    `Info: ${DISCORD_INFO_COMMANDS.join(', ')}`,
    `Utility: ${DISCORD_UTILITY_COMMANDS.join(', ')}`,
    `Use !admin for mod-only Discord commands.`,
  ].join(' | ');
}

export function buildDiscordAdminCommandsSummary(options: CatalogOptions): string {
  if (!options.isMod) {
    return 'Only mods can view admin Discord commands.';
  }

  return `Discord mod commands: ${DISCORD_ADMIN_COMMANDS.join(', ')}`;
}
