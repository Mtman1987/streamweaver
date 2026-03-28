treamsimport fs from 'fs';
import path from 'path';
import { sendChatMessage } from './twitch';

const TAG_STATS_FILE = path.join(process.cwd(), 'data', 'tag-stats.json');

interface TagPlayer {
  id: string;
  username: string;
  avatar: string;
  joinedAt: number;
}

interface TagStats {
  players: TagPlayer[];
  currentIt?: string;
  gameStarted?: number;
}

let tagStatsCache: TagStats | null = null;
let lastCacheTime = 0;

function loadTagStats(): TagStats {
  const now = Date.now();
  if (tagStatsCache && now - lastCacheTime < 30000) { // Cache for 30 seconds
    return tagStatsCache;
  }

  try {
    if (!fs.existsSync(TAG_STATS_FILE)) {
      tagStatsCache = { players: [] };
    } else {
      tagStatsCache = JSON.parse(fs.readFileSync(TAG_STATS_FILE, 'utf-8'));
    }
    lastCacheTime = now;
    return tagStatsCache;
  } catch (error) {
    console.error('Failed to load tag stats:', error);
    return { players: [] };
  }
}

function saveTagStats(stats: TagStats): void {
  try {
    fs.writeFileSync(TAG_STATS_FILE, JSON.stringify(stats, null, 2));
    tagStatsCache = stats;
    lastCacheTime = Date.now();
  } catch (error) {
    console.error('Failed to save tag stats:', error);
  }
}

export function getTagPlayers(): TagPlayer[] {
  return loadTagStats().players;
}

export function getTagPlayerCount(): number {
  return getTagPlayers().length;
}

export async function handleTagPlayersCommand(username: string, args: string[]): Promise<void> {
  const players = getTagPlayers();
  const totalPlayers = players.length;

  if (totalPlayers === 0) {
    await sendChatMessage(`@${username}, no players have joined the tag game yet! Use @spmt join to join.`, 'broadcaster');
    return;
  }

  // Parse page argument
  let page = 1;
  if (args.length > 0) {
    const pageArg = parseInt(args[0]);
    if (!isNaN(pageArg) && pageArg > 0) {
      page = pageArg;
    }
  }

  const playersPerPage = 15;
  const totalPages = Math.ceil(totalPlayers / playersPerPage);

  // Ensure page is within bounds
  if (page > totalPages) {
    page = totalPages;
  }
  if (page < 1) {
    page = 1;
  }

  const startIndex = (page - 1) * playersPerPage;
  const endIndex = Math.min(startIndex + playersPerPage, totalPlayers);
  const pagePlayers = players.slice(startIndex, endIndex);

  const playerNames = pagePlayers.map(p => p.username).join(', ');

  // Count live players (this would need to be implemented based on your live channel tracking)
  const liveResponse = await fetch('http://localhost:3100/api/twitch/live', {
  const liveCount = 0; // Placeholder
  const chattingCount = 0; // Placeholder
    body: JSON.stringify({ usernames: ['mtman1987'] }) // Community channels from config/API/bot/channels
  });
  const liveData = await liveResponse.json();
  const liveUsernames = liveData.liveUsers.map((u: any) => u.username.toLowerCase());
  const liveCount = liveUsernames.length;
  const chattingCount = liveUsernames.length; // Assume active = live for now

  let message = `@${username} ${totalPlayers} players`;
  if (liveCount > 0 || chattingCount > 0) {
    message += ` [🟢${liveCount} live, 💬${chattingCount} chatting]`;
  }
  message += ` (${page}/${totalPages}, all players): ${playerNames}`;

  if (page < totalPages) {
    message += ` | "@spmt more" for next`;
  }
  if (page > 1) {
    message += ` | "@spmt prev" for previous`;
  }

  await sendChatMessage(message, 'broadcaster');
}

export async function handleTagMoreCommand(username: string, currentPage: number = 1): Promise<void> {
  // This would need session tracking to know the current page for each user
  // For now, just show page 2
  await handleTagPlayersCommand(username, [(currentPage + 1).toString()]);
}

export async function handleTagPrevCommand(username: string, currentPage: number = 2): Promise<void> {
  // This would need session tracking
  await handleTagPlayersCommand(username, [Math.max(1, currentPage - 1).toString()]);
}