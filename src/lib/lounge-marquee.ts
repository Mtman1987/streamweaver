import { LOUNGE_COMMAND_CATEGORIES } from '@/lib/lounge-command-directory';

export const LOUNGE_MARQUEE_INTERVAL_MS = 10 * 60 * 1000;
export const LOUNGE_MARQUEE_WINDOW_MS = 2 * 60 * 1000;

export type LoungeMarqueeMode = 'commands' | 'thanks';

export type LoungeMarqueeGame = {
  id: string;
  name: string;
  command: string;
  playerCommands?: Array<{ trigger: string; description?: string }>;
};

const ALWAYS_ON_CATEGORY_SLUGS = new Set(['general', 'social', 'collecting', 'community']);

function publicTwitchCommands(slugs: Set<string>): string[] {
  return LOUNGE_COMMAND_CATEGORIES
    .filter((category) => slugs.has(category.slug))
    .flatMap((category) => category.commands)
    .filter((command) => command.audience !== 'moderator' && command.surfaces.includes('Twitch'))
    .map((command) => command.command);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

export const LOUNGE_ALWAYS_ON_COMMANDS = unique(publicTwitchCommands(ALWAYS_ON_CATEGORY_SLUGS));
export const LOUNGE_MEDIA_COMMANDS = unique(publicTwitchCommands(new Set(['media'])));

export const LOUNGE_THANKS_MESSAGE = [
  'SpaceMountain.live sends its many thanks to Twitch, Discord, OpenAI, Streamer.bot, Fly.io,',
  'our partner communities, every service and creator who helped make this possible,',
  'and viewers like you. Thanks for riding with us.',
].join(' ');

export function loungeMarqueeMoment(now = Date.now()): {
  expanded: boolean;
  mode: LoungeMarqueeMode;
  cycle: number;
  elapsedMs: number;
} {
  const cycle = Math.floor(now / LOUNGE_MARQUEE_INTERVAL_MS);
  const elapsedMs = now - cycle * LOUNGE_MARQUEE_INTERVAL_MS;
  return {
    expanded: elapsedMs < LOUNGE_MARQUEE_WINDOW_MS,
    mode: cycle % 2 === 0 ? 'commands' : 'thanks',
    cycle,
    elapsedMs,
  };
}

export function buildLoungeCommandMarquee(games: LoungeMarqueeGame[]): string {
  const sections = [
    `ALWAYS AVAILABLE — ${LOUNGE_ALWAYS_ON_COMMANDS.join(' · ')}`,
    `HEARMEOUT MEDIA — ${LOUNGE_MEDIA_COMMANDS.join(' · ')}`,
  ];

  for (const game of games) {
    const commands = unique([
      ...(Array.isArray(game.playerCommands) ? game.playerCommands.map((command) => command.trigger) : []),
      ...(!game.playerCommands?.length && game.command ? [`spmt ${game.command}`] : []),
    ]);
    if (commands.length) sections.push(`${String(game.name || 'ACTIVE GAME').toUpperCase()} — ${commands.join(' · ')}`);
  }

  return sections.join('   ✦   ');
}
