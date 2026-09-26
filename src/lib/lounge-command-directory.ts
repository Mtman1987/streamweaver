export type LoungeCommandAudience = 'everyone' | 'moderator';

export type LoungeCommandEntry = {
  command: string;
  description: string;
  service: 'Lounge' | 'StreamWeaver' | 'HearMeOut' | 'Nebula Arcade' | 'DiscordStreamHub' | 'Twitch';
  surfaces: string;
  audience?: LoungeCommandAudience;
};

export type LoungeCommandCategory = {
  number: number;
  slug: string;
  name: string;
  icon: string;
  description: string;
  commands: LoungeCommandEntry[];
};

export const COMMAND_GUIDE_URL = String(
  process.env.NEXT_PUBLIC_COMMAND_GUIDE_URL || 'https://streamweaver-new.fly.dev/command-guide',
).replace(/\/$/, '');

const entry = (
  command: string,
  description: string,
  service: LoungeCommandEntry['service'],
  surfaces = 'Twitch + Discord',
  audience: LoungeCommandAudience = 'everyone',
): LoungeCommandEntry => ({ command, description, service, surfaces, audience });

export const LOUNGE_COMMAND_CATEGORIES: LoungeCommandCategory[] = [
  {
    number: 1,
    slug: 'general',
    name: 'General & profile',
    icon: '📚',
    description: 'Help, profiles, status, points, watch time and leaderboards.',
    commands: [
      entry('!commands', 'Open this numbered command directory.', 'StreamWeaver'),
      entry('!points', 'Show your points balance.', 'DiscordStreamHub'),
      entry('!watchtime', 'Show your StreamWeaver watch activity.', 'StreamWeaver'),
      entry('!followage [@user]', 'Show how long someone has followed.', 'Twitch', 'Twitch'),
      entry('!followed', 'Check whether you follow the channel.', 'Twitch', 'Twitch'),
      entry('!followers', 'Show the channel follower count.', 'Twitch', 'Twitch'),
      entry('!uptime', 'Show how long the current stream has been live.', 'Twitch', 'Twitch'),
      entry('!stats', 'Show current channel statistics.', 'StreamWeaver'),
      entry('!time', 'Show PST, MST, CST, EST and UTC.', 'StreamWeaver'),
      entry('!leader / !leaderboard', 'Show the primary leaderboard.', 'DiscordStreamHub'),
      entry('!pleader / !wleader', 'Show points or watch leaderboards.', 'DiscordStreamHub'),
      entry('!cleader / !bleader / !bitsleader', 'Show chat, bot or bits leaderboards.', 'DiscordStreamHub'),
      entry('!lurk / !unlurk', 'Set or clear your lurk state.', 'StreamWeaver'),
    ],
  },
  {
    number: 2,
    slug: 'social',
    name: 'Social & interactions',
    icon: '🫂',
    description: 'Friendly chat actions, shoutouts, translation, images and speech.',
    commands: [
      entry('!hug @user / !boop @user', 'Send a hug or boop interaction.', 'StreamWeaver'),
      entry('!cuddle @user / !fistbump @user', 'Send a cuddle or fist-bump interaction.', 'StreamWeaver'),
      entry('!headpat @user / !highfive @user', 'Send a headpat or high-five.', 'StreamWeaver'),
      entry('!love @user / !tickle @user', 'Send a love or tickle interaction.', 'StreamWeaver'),
      entry('!dance / !hover', 'Trigger a social animation.', 'StreamWeaver'),
      entry('!so @user / !s @user', 'Request a community shoutout.', 'DiscordStreamHub'),
      entry('!img <description>', 'Generate and share an image when enabled.', 'StreamWeaver'),
      entry('!t es <message> / !t <message>', 'Translate one phrase; English is the default target.', 'StreamWeaver'),
      entry('!t @user en / !t @user off', 'Auto-translate a viewer into a target language; mods can set other viewers.', 'StreamWeaver'),
      entry('!say on / !say off', 'Opt your messages into or out of chat TTS.', 'StreamWeaver'),
    ],
  },
  {
    number: 3,
    slug: 'media',
    name: 'Media & Lounge',
    icon: '🎬',
    description: 'Request and inspect the Lounge’s single HearMeOut media player.',
    commands: [
      entry('!sr <song or URL>', 'Request music for the shared Lounge player.', 'HearMeOut'),
      entry('!wr <movie, show or video>', 'Request something to watch.', 'HearMeOut'),
      entry('!np / !nowplaying', 'Show the current music and movie state.', 'HearMeOut'),
      entry('!votebump', 'Vote to swap HearMeOut with the current Spotlight.', 'Lounge', 'Twitch'),
      entry('!bump', 'Immediately swap HearMeOut with the current Spotlight.', 'Lounge', 'Twitch', 'moderator'),
      entry('!play [music|movie]', 'Resume a media lane.', 'HearMeOut', 'Twitch', 'moderator'),
      entry('!pause / !stop [music|movie]', 'Pause a media lane.', 'HearMeOut', 'Twitch', 'moderator'),
      entry('!skip / !next [music|movie]', 'Advance a media lane.', 'HearMeOut', 'Twitch', 'moderator'),
      entry('!clear [music|movie]', 'Clear a media lane.', 'HearMeOut', 'Twitch', 'moderator'),
      entry('!vol / !volume [stella|spotlight|media] [1-100]', 'Adjust the single OBS broadcast mix for Stella, Spotlight, and media.', 'Lounge', 'Twitch', 'moderator'),
    ],
  },
  {
    number: 4,
    slug: 'arcade',
    name: 'Nebula Arcade',
    icon: '🕹️',
    description: 'Chat Tag and every Lounge game command currently routed through Nebula Arcade.',
    commands: [
      entry('spmt join / spmt leave', 'Join or leave Chat Tag or an active game.', 'Nebula Arcade'),
      entry('spmt help / rules / score / status / rank', 'Chat Tag help and state.', 'Nebula Arcade'),
      entry('spmt tag @user / spmt pass @user / spmt away', 'Play Chat Tag.', 'Nebula Arcade'),
      entry('spmt players / spmt live', 'List players or live community members.', 'Nebula Arcade'),
      entry('spmt card / claim 12 / phrases', 'Play Bingo.', 'Nebula Arcade'),
      entry('spmt chaos / explode / glitch / portal / shake', 'Play Chaos Mode.', 'Nebula Arcade'),
      entry('spmt garden / grow', 'Join Chat Garden.', 'Nebula Arcade'),
      entry('spmt wars / red / blue / green / yellow', 'Play Chat Wars.', 'Nebula Arcade'),
      entry('spmt colors / red / blue / green / yellow', 'Play Color Wars.', 'Nebula Arcade'),
      entry('spmt chicken / hatch', 'Enter Chicken Royale.', 'Nebula Arcade'),
      entry('spmt symphony / harmony', 'Join Color Symphony.', 'Nebula Arcade'),
      entry('spmt parade / dance / <emoji>', 'Join the Cosmic Conga Line.', 'Nebula Arcade'),
      entry('spmt rain', 'Join Emoji Rain.', 'Nebula Arcade'),
      entry('spmt tower / drop', 'Play Emoji Tower.', 'Nebula Arcade'),
      entry('spmt memory', 'Join Memory Lane.', 'Nebula Arcade'),
      entry('spmt pet dog|cat|rabbit|turtle|hamster', 'Enter Pet Race.', 'Nebula Arcade'),
      entry('spmt phrase / phrase hint / phrase submit <text>', 'Play Phrase Guess.', 'Nebula Arcade'),
      entry('!mosaic <theme>', 'Request a free testing artwork theme.', 'Nebula Arcade'),
      entry('spmt D12Y / spmt view 1-4 / spmt view all', 'Paint or navigate Nebula Mosaic.', 'Nebula Arcade'),
      entry('spmt rhythm', 'Join Rhythm Pulse.', 'Nebula Arcade'),
      entry('spmt treasure / dig B5', 'Play Treasure Hunt.', 'Nebula Arcade'),
      entry('spmt chain', 'Join Word Chain.', 'Nebula Arcade'),
      entry('spmt storm', 'Join Word Storm.', 'Nebula Arcade'),
      entry('spmt quackverse / spmt pack', 'Open Quackverse or a booster pack.', 'Nebula Arcade'),
    ],
  },
  {
    number: 5,
    slug: 'collecting',
    name: 'Pokémon, games & economy',
    icon: '🃏',
    description: 'StreamWeaver’s Pokémon collection, trades, battles and channel-point games.',
    commands: [
      entry('!pack [set]', 'Open a Pokémon booster pack.', 'StreamWeaver'),
      entry('!collection / !collections / !pokedex', 'Open your collection.', 'StreamWeaver'),
      entry('!show <card>', 'Show a card you own.', 'StreamWeaver'),
      entry('!deck / !setdeck <cards>', 'View or set your battle deck.', 'StreamWeaver'),
      entry('!trade @user / !offer <card>', 'Start or update a trade.', 'StreamWeaver'),
      entry('!accept / !cancel / !swap <card>', 'Respond to a pending trade.', 'StreamWeaver'),
      entry('!challenge / !attack / !switch', 'Play a Pokémon battle.', 'StreamWeaver'),
      entry('!gymteam', 'Show or manage your gym team.', 'StreamWeaver'),
      entry('!gamble <amount> / !roll <amount>', 'Play channel-point games.', 'StreamWeaver'),
      entry('!double <amount> / !coinflip', 'Play double-or-nothing or flip a coin.', 'StreamWeaver'),
      entry('!givepoints @user <amount>', 'Give another viewer points.', 'DiscordStreamHub'),
      entry('!stealpoints @user <amount>', 'Attempt the enabled points-steal game.', 'DiscordStreamHub'),
    ],
  },
  {
    number: 6,
    slug: 'community',
    name: 'Community & Discord',
    icon: '🛰️',
    description: 'Community check-ins, support, Discord controls and ecosystem discovery.',
    commands: [
      entry('!checkin / !partner', 'Run the partner community check-in.', 'DiscordStreamHub'),
      entry('!crew / !crewcheckin', 'Run the crew check-in.', 'DiscordStreamHub'),
      entry('!mod / !modcheckin', 'Run the moderator check-in.', 'DiscordStreamHub'),
      entry('!spacemountain / !space', 'Run the Space Mountain check-in.', 'DiscordStreamHub'),
      entry('!mtfixit <problem>', 'Report a broken ecosystem feature.', 'DiscordStreamHub'),
      entry('!dm me', 'Ask the Discord bot to move the conversation to a DM.', 'DiscordStreamHub', 'Discord'),
      entry('spmt controls', 'Open Discord Chat Tag controls.', 'DiscordStreamHub', 'Discord'),
      entry('spmt apps', 'Show connected ecosystem apps.', 'StreamWeaver', 'Discord'),
      entry('spmt music', 'Show HearMeOut state from the SPMT command bridge.', 'StreamWeaver', 'Discord'),
    ],
  },
  {
    number: 7,
    slug: 'twitch',
    name: 'Twitch built-ins',
    icon: '💬',
    description: 'Commands handled by Twitch itself rather than an SPMT bot.',
    commands: [
      entry('/me <message>', 'Send an action-style chat message.', 'Twitch', 'Twitch'),
      entry('/w <user> <message>', 'Whisper another Twitch user.', 'Twitch', 'Twitch'),
      entry('/color <color>', 'Change your Twitch chat-name color.', 'Twitch', 'Twitch'),
      entry('/block <user> / /unblock <user>', 'Manage your Twitch block list.', 'Twitch', 'Twitch'),
      entry('/mods / /vips', 'Show channel moderators or VIPs.', 'Twitch', 'Twitch'),
      entry('/timeout <user> [seconds] / /untimeout <user>', 'Temporarily restrict a viewer.', 'Twitch', 'Twitch', 'moderator'),
      entry('/ban <user> / /unban <user>', 'Manage channel bans.', 'Twitch', 'Twitch', 'moderator'),
      entry('/slow / /followers / /subscribers', 'Change Twitch chat participation modes.', 'Twitch', 'Twitch', 'moderator'),
      entry('/clear', 'Clear Twitch chat history.', 'Twitch', 'Twitch', 'moderator'),
      entry('/raid <channel> / /unraid', 'Start or cancel a Twitch raid.', 'Twitch', 'Twitch', 'moderator'),
    ],
  },
  {
    number: 8,
    slug: 'admin',
    name: 'Moderator & admin',
    icon: '🔧',
    description: 'Restricted channel, automation, media and points controls.',
    commands: [
      entry('!admin', 'Show the compact moderator command list.', 'StreamWeaver', 'Twitch + Discord', 'moderator'),
      entry('!so @user / !timeout @user [duration] [reason]', 'Shout out or time out a viewer.', 'DiscordStreamHub', 'Twitch + Discord', 'moderator'),
      entry('!setgame <game> / !settitle <title>', 'Update Twitch channel information.', 'Twitch', 'Twitch', 'moderator'),
      entry('!raidmessage <message>', 'Set the reusable raid message.', 'StreamWeaver', 'Twitch', 'moderator'),
      entry('!greetingmode / !welcomemode / !clipmode / !chatmode', 'Toggle StreamWeaver operating modes.', 'StreamWeaver', 'Twitch', 'moderator'),
      entry('!gamblemode / !pokemode / !botshare', 'Toggle games, Pokémon or bot sharing.', 'StreamWeaver', 'Twitch', 'moderator'),
      entry('!athenaeverywhere [on|off|status]', 'Control shared-chat Athena routing.', 'StreamWeaver', 'Twitch', 'moderator'),
      entry('!brb / !back', 'Change the stream BRB state.', 'StreamWeaver', 'Twitch', 'moderator'),
      entry('!ignore @user / !unignore @user', 'Manage ignored bot or user triggers.', 'StreamWeaver', 'Twitch + Discord', 'moderator'),
      entry('!addPoints / !setPoints / !addToAll / !setToAll', 'Manage tenant points.', 'DiscordStreamHub', 'Twitch + Discord', 'moderator'),
      entry('!resetAllPoints', 'Reset tenant points.', 'DiscordStreamHub', 'Twitch + Discord', 'moderator'),
      entry('!addflow <prompt>', 'Draft a workflow from chat.', 'StreamWeaver', 'Twitch + Discord', 'moderator'),
      entry('!approveflow / !disableflow / !deleteflow <!command>', 'Manage generated workflows.', 'StreamWeaver', 'Twitch + Discord', 'moderator'),
      entry('!music / !movie / !play / !pause / !skip / !clear', 'Control the shared HearMeOut lanes.', 'HearMeOut', 'Twitch', 'moderator'),
      entry('!bump / !media big / !stream big / !layout auto', 'Swap, override, or reopen Lounge layout voting.', 'Lounge', 'Twitch', 'moderator'),
      entry('spmt givepass @user / spmt mute', 'Manage Chat Tag passes or overlay mode.', 'Nebula Arcade', 'Twitch', 'moderator'),
    ],
  },
];

export function getLoungeCommandCategory(number: number) {
  return LOUNGE_COMMAND_CATEGORIES.find((category) => category.number === number) || null;
}

export function buildLoungeCommandMenu(guideUrl = COMMAND_GUIDE_URL): string {
  const categories = LOUNGE_COMMAND_CATEGORIES
    .map((category) => `${category.number} ${category.icon}${category.name}`)
    .join(' · ');
  return `Commands by category: ${categories} | Reply with 1-${LOUNGE_COMMAND_CATEGORIES.length} within 2 minutes. Full bookmarkable guide: ${guideUrl}`;
}

export function buildLoungeCategoryReplies(number: number, isMod: boolean, guideUrl = COMMAND_GUIDE_URL): string[] {
  const category = getLoungeCommandCategory(number);
  if (!category) return [buildLoungeCommandMenu(guideUrl)];
  if (category.slug === 'admin' && !isMod) return ['Moderator and admin commands are only shown to channel moderators.'];
  const commands = category.commands.filter((command) => command.audience !== 'moderator' || isMod);
  const labels = commands.map((command) => command.command);
  const replies: string[] = [];
  let current = `${category.icon} ${category.name}: `;
  for (const label of labels) {
    const next = `${current.endsWith(': ') ? '' : ' · '}${label}`;
    if (current.length + next.length > 420) {
      replies.push(current);
      current = `${category.icon} ${category.name} continued: ${label}`;
    } else {
      current += next;
    }
  }
  if (!replies.length || current.length > `${category.icon} ${category.name}: `.length) replies.push(current);
  replies[replies.length - 1] += ` | Details: ${guideUrl}#${category.slug}`;
  return replies;
}
