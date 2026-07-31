type CatalogOptions = {
  isMod: boolean;
};

const DISCORD_FUN_COMMANDS = [
  '!hug', '!boop', '!cuddle', '!dance', '!fistbump', '!headpat', '!highfive', '!love', '!tickle', '!hover',
  '!lurk', '!unlurk', '!hydrate', '!stretch', '!yes', '!yup', '!no',
];

const DISCORD_LINK_COMMANDS: string[] = [];

const DISCORD_INFO_COMMANDS = [
  '!points', '!watchtime', '!leader', '!pleader', '!wleader', '!cleader', '!bleader', '!bitsleader', '!time', '!followers', '!uptime', '!stats',
  '!pack [set]', '!collection', '!show <card>', '!eevee', '!deck',
];

const DISCORD_UTILITY_COMMANDS = [
  '!commands', '!so <user>', '!trade @user', '!offer <card>', '!givepoints @user <amount>', '!stealpoints @user <amount>', '!gamble <amount>', '!roll <amount>', '!double <amount>', '!botshare', '!mtfixit', '!raidmessage <msg>',
];

const DISCORD_ADMIN_COMMANDS = [
  '!admin', '!ignore <user>',
  '!addPoints @user <amount>', '!setPoints @user <amount>', '!addToAll <amount>', '!setToAll <amount>', '!resetAllPoints',
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
  '!addPoints @user <amount>',
  '!setPoints @user <amount>',
  '!addToAll <amount>',
  '!setToAll <amount>',
  '!resetAllPoints',
])).map(commandName);

export const DISCORD_UNSUPPORTED_COMMAND_MESSAGES: Record<string, string> = {
  discord: 'Discord link commands are disabled here until their real reply flow is wired.',
  instagram: 'Social link commands are disabled here until their real reply flow is wired.',
  merch: 'Social link commands are disabled here until their real reply flow is wired.',
  tiktok: 'Social link commands are disabled here until their real reply flow is wired.',
  twitter: 'Social link commands are disabled here until their real reply flow is wired.',
  webpage: 'Social link commands are disabled here until their real reply flow is wired.',
  youtube: 'Social link commands are disabled here until their real reply flow is wired.',
  accept: 'Use the green Accept Trade button on the active trade embed.',
  cancel: 'Use the red Decline button on the active trade embed.',
  challenge: 'Discord battle commands need a Discord-specific interaction flow first.',
  attack: 'Discord battle commands need a Discord-specific interaction flow first.',
  switch: 'Discord battle commands need a Discord-specific interaction flow first.',
  setdeck: 'Discord deck commands need a Discord-specific interaction flow first.',
  followage: 'Discord followage is Twitch-specific and is not supported here.',
  followed: 'Discord followed status needs a Twitch identity mapping first.',
  clip: 'Discord clip needs explicit tenant targeting or a Discord-native clip design first.',
  brb: 'BRB controls are Twitch/stream-state specific and are not supported in Discord.',
  back: 'BRB controls are Twitch/stream-state specific and are not supported in Discord.',
  setgame: 'Setting stream game from Discord is disabled here.',
  settitle: 'Setting stream title from Discord is disabled here.',
};

export function buildDiscordCommandsSummary(): string {
  const sections = [
    `Discord commands`,
    `Fun: ${DISCORD_FUN_COMMANDS.join(', ')}`,
    `Info: ${DISCORD_INFO_COMMANDS.join(', ')}`,
    `Utility: ${DISCORD_UTILITY_COMMANDS.join(', ')}`,
    `Use !admin for mod-only Discord commands.`,
  ];
  if (DISCORD_LINK_COMMANDS.length > 0) {
    sections.splice(2, 0, `Links: ${DISCORD_LINK_COMMANDS.join(', ')}`);
  }
  return sections.join(' | ');
}

export function buildDiscordAdminCommandsSummary(options: CatalogOptions): string {
  if (!options.isMod) {
    return 'Only mods can view admin Discord commands.';
  }

  return `Discord mod commands: ${DISCORD_ADMIN_COMMANDS.join(', ')}`;
}
