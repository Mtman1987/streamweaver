type CatalogOptions = {
  isMod: boolean;
};

const DISCORD_FUN_COMMANDS = [
  '!hug', '!boop', '!cuddle', '!dance', '!fistbump', '!headpat', '!highfive', '!love', '!tickle', '!hover',
  '!lurk', '!unlurk', '!hydrate', '!stretch', '!yes', '!yup', '!no',
];

const DISCORD_GAME_COMMANDS = [
  '!points', '!gamble', '!roll', '!double', '!coinflip',
];

const DISCORD_POKEMON_COMMANDS = [
  '!pack', '!collection', '!show <card>', '!trade <user>', '!offer <card>', '!accept', '!cancel',
  '!challenge', '!attack', '!switch', '!setdeck', '!deck', '!eevee',
];

const DISCORD_INFO_COMMANDS = [
  '!time', '!watchtime',
];

const DISCORD_LEADER_COMMANDS = [
  '!leader', '!pleader', '!wleader', '!cleader', '!bleader', '!bitsleader',
];

const DISCORD_UTILITY_COMMANDS = [
  '!commands', '!so <user>', '!botshare', '!mtfixit',
];

const DISCORD_ADMIN_COMMANDS = [
  '!admin', '!setgame <game>', '!settitle <title>', '!raidmessage <msg>', '!ignore <user>',
  '!timeout <user> [duration] [reason]',
  '!greetingmode', '!welcomemode', '!clipmode', '!chatmode', '!athenaeverywhere',
  '!brb', '!back', '!addflow <prompt>', '!approveflow <!command>', '!disableflow <!command>', '!deleteflow <!command>',
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
  ...DISCORD_POKEMON_COMMANDS,
  ...DISCORD_LEADER_COMMANDS,
  '!setgame <game>',
  '!settitle <title>',
  '!raidmessage <msg>',
  '!greetingmode',
  '!welcomemode',
  '!clipmode',
  '!chatmode',
  '!athenaeverywhere',
  '!brb',
  '!back',
  '!addflow <prompt>',
  '!approveflow <!command>',
  '!disableflow <!command>',
  '!deleteflow <!command>',
])).map(commandName);

export function buildDiscordCommandsSummary(): string {
  return [
    `Discord commands`,
    `Fun: ${DISCORD_FUN_COMMANDS.join(', ')}`,
    `Games: ${DISCORD_GAME_COMMANDS.join(', ')}`,
    `Pokemon: ${DISCORD_POKEMON_COMMANDS.join(', ')}`,
    `Info: ${DISCORD_INFO_COMMANDS.join(', ')}`,
    `Leaders: ${DISCORD_LEADER_COMMANDS.join(', ')}`,
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
