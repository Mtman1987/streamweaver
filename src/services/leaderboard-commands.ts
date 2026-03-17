import { getLeaderboard, getUser, getUserRank } from './user-stats';
import { sendChatMessage } from './twitch';
import { getDiscordMessage } from './discord';
import * as fs from 'fs';
import * as path from 'path';

const DISCORD_IDS_FILE = path.join(process.cwd(), 'data', 'pokemon-discord-ids.json');
const STORAGE_CHANNEL_ID = '1476540488147533895';

function loadDiscordIds(): Record<string, string> {
  try {
    if (fs.existsSync(DISCORD_IDS_FILE)) return JSON.parse(fs.readFileSync(DISCORD_IDS_FILE, 'utf-8'));
  } catch {}
  return {};
}

async function getCardCountFromDiscord(username: string): Promise<{ total: number; packs: number } | null> {
  const ids = loadDiscordIds();
  const msgId = ids[username.toLowerCase()];
  if (!msgId) return null;
  try {
    const msg = await getDiscordMessage(STORAGE_CHANNEL_ID, msgId);
    if (msg?.content) {
      // Parse "User: mtman1987 | 63 cards, 7 packs opened"
      const match = msg.content.match(/(\d+)\s*cards.*?(\d+)\s*packs/);
      if (match) return { total: parseInt(match[1]), packs: parseInt(match[2]) };
    }
  } catch {}
  return null;
}

const COOLDOWNS = {
  user: new Map<string, number>(),
  global: 0
};

function checkCooldown(username: string): boolean {
  const now = Date.now();
  
  if (now - COOLDOWNS.global < 300) return false;
  COOLDOWNS.global = now;
  
  const lastUser = COOLDOWNS.user.get(username) || 0;
  if (now - lastUser < 2000) return false;
  COOLDOWNS.user.set(username, now);
  
  return true;
}

export async function handleLeaderboardCommand(
  command: string,
  username: string,
  args: string,
  broadcast: (message: { type: string; payload: unknown }) => void,
) {
  if (!checkCooldown(username)) return;
  
  const user = await getUser(username);
  
  // Get real card count from Discord message content
  const discordCards = await getCardCountFromDiscord(username);
  const realTotal = discordCards?.total ?? user.totalCards;
  const realRare = discordCards ? 0 : user.rareCards; // Discord msg doesn't have rare count
  
  // !leader - show profile
  if (command === '!leader') {
    const profile = {
      type: 'profile',
      user: username,
      points: user.points,
      watchtime: user.watchtime,
      deaths: user.deaths,
      visits: user.visits,
      lastSeen: user.lastSeen,
      joinDate: user.joinDate,
      totalCards: realTotal,
      rareCards: realRare,
      badges: user.badges
    };
    
    broadcast({
      type: 'leaderboard-profile',
      payload: profile
    });
    
    // Send chat response
    const hours = Math.floor(user.watchtime / 60);
    const badgeList = user.badges.length > 0 ? ` | Badges: ${user.badges.join(', ')}` : '';
    const cardStr = discordCards ? `Cards: ${realTotal} (${discordCards.packs} packs)` : `Cards: ${realTotal}`;
    sendChatMessage(
      `@${username} | Points: ${user.points.toLocaleString()} | Watchtime: ${hours}h | ${cardStr}${badgeList}`,
      'bot'
    ).catch(() => {});
    return;
  }
  
  // Determine stat type
  let stat: 'points' | 'watchtime' | 'totalCards' | 'rareCards' | 'badges';
  let statName: string;
  
  switch (command) {
    case '!pleader':
      stat = 'points';
      statName = 'Points';
      break;
    case '!wleader':
      stat = 'watchtime';
      statName = 'Watchtime';
      break;
    case '!cleader':
      stat = 'totalCards';
      statName = 'Cards';
      break;
    case '!bleader':
      stat = 'badges';
      statName = 'Badges';
      break;
    case '!bitsleader':
      stat = 'points';
      statName = 'Points';
      break;
    default:
      return;
  }
  
  const leaderboard = await getLeaderboard(stat, 10);
  const myRank = await getUserRank(username, stat);
  let myValue = stat === 'badges' ? user.badges.length : user[stat];
  // Use real card count from Discord if available
  if ((stat === 'totalCards') && discordCards) myValue = discordCards.total;
  
  // Check for @mention comparison
  const mentionMatch = args.match(/@(\w+)/);
  if (mentionMatch) {
    const target = mentionMatch[1].toLowerCase();
    const other = await getUser(target);
    const theirRank = await getUserRank(target, stat);
    let theirValue = stat === 'badges' ? other.badges.length : other[stat];
    // Use real card count from Discord for target too
    if (stat === 'totalCards') {
      const targetCards = await getCardCountFromDiscord(target);
      if (targetCards) theirValue = targetCards.total;
    }
    
    broadcast({
      type: 'leaderboard-compare',
      payload: {
        stat: statName.toLowerCase(),
        requester: { user: username, rank: myRank, value: myValue },
        target: { user: target, rank: theirRank, value: theirValue },
        ahead: myRank < theirRank
      }
    });
    
    // Send chat response
    const ahead = myRank < theirRank;
    const emoji = ahead ? '🎯' : '💥';
    sendChatMessage(
      `@${username} (#${myRank} - ${myValue}) vs @${target} (#${theirRank} - ${theirValue}) → ${ahead ? 'You\'re ahead!' : 'They\'re ahead!'} ${emoji}`,
      'bot'
    ).catch(() => {});
  } else {
    broadcast({
      type: 'leaderboard-top',
      payload: {
        stat: statName.toLowerCase(),
        title: `Top 10 by ${statName}`,
        entries: leaderboard.map((u, i) => ({
          rank: i + 1,
          user: u.user,
          value: stat === 'badges' ? u.badges.length : u[stat],
          badges: u.badges,
          totalCards: u.totalCards,
          rareCards: u.rareCards
        })),
        you: { user: username, rank: myRank, value: myValue }
      }
    });
    
    // Send chat response
    let chatMsg = `@${username}, you're currently #${myRank} with ${myValue} ${statName.toLowerCase()}!`;
    if (stat === 'badges' && user.badges.length > 0) {
      chatMsg += ` (${user.badges.join(', ')})`;
    }
    sendChatMessage(chatMsg, 'bot').catch(() => {});
  }
}
