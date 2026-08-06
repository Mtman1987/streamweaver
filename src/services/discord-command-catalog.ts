type CatalogOptions = {
  isMod: boolean;
};

export type DiscordCommandDirectorySection = {
  name: string;
  value: string;
  inline?: boolean;
};

const DISCORD_PRIMARY_FUN_COMMANDS = [
  '!hug @user', '!boop @user', '!cuddle @user', '!dance', '!fistbump @user',
  '!headpat @user', '!highfive @user', '!love @user', '!tickle @user',
  '!hover', '!lurk', '!unlurk',
];

const DISCORD_SECONDARY_TRIGGER_COMMANDS = ['!yes', '!yup', '!no'];

const DISCORD_LINK_COMMANDS: string[] = [];

const DISCORD_INFO_COMMANDS = [
  '!points', '!watchtime', '!leader', '!leaderboard', '!pleader', '!wleader',
  '!cleader', '!bleader', '!bitsleader', '!time', '!followers', '!uptime',
  '!stats', '!pack [set]', '!collection', '!collections', '!show <card>',
  '!eevee', '!deck',
];

const DISCORD_UTILITY_COMMANDS = [
  '!commands', '!s <user>', '!so <user>', '!trade @user', '!offer <card>',
  '!givepoints @user <amount>', '!stealpoints @user <amount>',
  '!gamble <amount>', '!roll <amount>', '!double <amount>', '!coinflip',
  '!botshare', '!raidmessage <msg>',
];

const DISCORD_ADMIN_COMMANDS = [
  '!admin', '!ignore <user>',
  '!addPoints @user <amount>', '!setPoints @user <amount>',
  '!addToAll <amount>', '!setToAll <amount>', '!resetAllPoints',
  '!timeout <user> [duration] [reason]',
  '!greetingmode', '!welcomemode', '!clipmode', '!chatmode', '!athenaeverywhere',
  '!addflow <prompt>', '!approveflow <!command>', '!disableflow <!command>',
  '!deleteflow <!command>',
];

function commandName(label: string): string {
  return label.trim().split(/\s+/)[0].replace(/^!/, '').toLowerCase();
}

export const DISCORD_ROUTED_COMMAND_NAMES = Array.from(new Set([
  ...DISCORD_PRIMARY_FUN_COMMANDS,
  ...DISCORD_SECONDARY_TRIGGER_COMMANDS,
  ...DISCORD_LINK_COMMANDS,
  ...DISCORD_INFO_COMMANDS,
  ...DISCORD_UTILITY_COMMANDS,
  ...DISCORD_ADMIN_COMMANDS,
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

function formatCommands(commands: string[]): string {
  return commands.map((command) => `\`${command}\``).join('  ');
}

export function buildDiscordCommandDirectoryFields(): DiscordCommandDirectorySection[] {
  return [
    { name: 'Social', value: formatCommands(DISCORD_PRIMARY_FUN_COMMANDS) },
    { name: 'Profile and leaderboards', value: formatCommands(DISCORD_INFO_COMMANDS.slice(0, 13)) },
    { name: 'Pokémon', value: formatCommands(DISCORD_INFO_COMMANDS.slice(13)) },
    { name: 'Games, economy, and tools', value: formatCommands(DISCORD_UTILITY_COMMANDS.filter((command) => command !== '!commands')) },
    { name: 'Moderator commands', value: 'Use `!admin` to view commands available to moderators.' },
  ];
}

export function buildDiscordCommandsSummary(): string {
  return 'Choose a category below. Commands with `@user` accept a Discord mention or username.';
}

export function buildDiscordAdminCommandsSummary(options: CatalogOptions): string {
  if (!options.isMod) return 'Only mods can view admin Discord commands.';
  return `Discord mod commands: ${DISCORD_ADMIN_COMMANDS.join(', ')}`;
}
