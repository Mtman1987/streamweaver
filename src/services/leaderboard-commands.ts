import { getLeaderboard, getUser, getUserRank } from './user-stats';
import { sendChatMessage } from './twitch';
import { getUserCards } from './pokemon-collection';

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
  broadcast: (message: { type: string; payload: unknown }, tid?: string) => void,
  tenantId?: string,
) {
  if (!checkCooldown(username)) return;
  
  const tenantCtx = tenantId ? { tenantId, username: '' } : undefined;

  // Resolve broadcaster username for storage context
  if (tenantCtx) {
    try {
      const { getStoredTokens } = require('../lib/token-utils.server');
      const tokens = await getStoredTokens(tenantId);
      if (tokens?.broadcasterUsername) tenantCtx.username = tokens.broadcasterUsername;
    } catch {}
  }

  const user = await getUser(username, tenantCtx);

  // Use tenant-scoped points
  const tenantPoints = user.points;
  
  // Get real card count from local collection
  const userCards = await getUserCards(username);
  const realTotal = userCards.length;
  const realRare = userCards.filter((c: any) => c.rarity?.includes('Rare')).length;
  
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
    }, tenantId);
    
    // Send chat response
    const totalHours = Math.floor(user.watchtime / 60);
    let channelUsername = '';
    try {
      const { getStoredTokens: gst } = require('../lib/token-utils.server');
      const t = await gst(tenantId);
      if (t?.broadcasterUsername) channelUsername = t.broadcasterUsername.toLowerCase();
    } catch {}
    const channelMinutes = channelUsername ? (user.watchtimeByChannel?.[channelUsername] || 0) : 0;
    const channelHours = Math.floor(channelMinutes / 60);
    const wtStr = channelUsername && channelMinutes > 0
      ? `Watchtime: ${channelHours}h (${totalHours}h total)`
      : `Watchtime: ${totalHours}h`;
    const badgeList = user.badges.length > 0 ? ` | Badges: ${user.badges.join(', ')}` : '';
    const cardStr = `Cards: ${realTotal} (${realRare} rare)`;
    sendChatMessage(
      `@${username} | Points: ${tenantPoints.toLocaleString()} | ${wtStr} | ${cardStr}${badgeList}`,
      'bot', undefined, tenantId
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
  
  const leaderboard = await getLeaderboard(stat, 10, tenantCtx);
  const myRank = await getUserRank(username, stat, tenantCtx);
  let myValue = stat === 'badges' ? user.badges.length : user[stat];
  if ((stat === 'totalCards')) {
    const myCards = await getUserCards(username);
    myValue = myCards.length;
  }
  
  // Check for @mention comparison
  const mentionMatch = args.match(/@(\w+)/);
  if (mentionMatch) {
    const target = mentionMatch[1].toLowerCase();
    const other = await getUser(target, tenantCtx);
    const theirRank = await getUserRank(target, stat, tenantCtx);
    let theirValue = stat === 'badges' ? other.badges.length : other[stat];
    if (stat === 'totalCards') {
      const targetCards = await getUserCards(target);
      theirValue = targetCards.length;
    }
    
    broadcast({
      type: 'leaderboard-compare',
      payload: {
        stat: statName.toLowerCase(),
        requester: { user: username, rank: myRank, value: myValue },
        target: { user: target, rank: theirRank, value: theirValue },
        ahead: myRank < theirRank
      }
    }, tenantId);
    
    // Send chat response
    const ahead = myRank < theirRank;
    const emoji = ahead ? '🎯' : '💥';
    sendChatMessage(
      `@${username} (#${myRank} - ${myValue}) vs @${target} (#${theirRank} - ${theirValue}) → ${ahead ? 'You\'re ahead!' : 'They\'re ahead!'} ${emoji}`,
      'bot', undefined, tenantId
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
    }, tenantId);
    
    // Send chat response
    let chatMsg = `@${username}, you're currently #${myRank} with ${myValue} ${statName.toLowerCase()}!`;
    if (stat === 'watchtime') {
      const totalMin = myValue as number;
      const totalH = Math.floor(totalMin / 60);
      let channelUsername = '';
      try {
        const { getStoredTokens: gst } = require('../lib/token-utils.server');
        const t = await gst(tenantId);
        if (t?.broadcasterUsername) channelUsername = t.broadcasterUsername.toLowerCase();
      } catch {}
      const chMin = channelUsername ? (user.watchtimeByChannel?.[channelUsername] || 0) : 0;
      const chH = Math.floor(chMin / 60);
      chatMsg = chMin > 0
        ? `@${username}, you're #${myRank} with ${chH}h here (${totalH}h total)!`
        : `@${username}, you're #${myRank} with ${totalH}h total watchtime!`;
    }
    if (stat === 'badges' && user.badges.length > 0) {
      chatMsg += ` (${user.badges.join(', ')})`;
    }
    sendChatMessage(chatMsg, 'bot', undefined, tenantId).catch(() => {});
  }
}
