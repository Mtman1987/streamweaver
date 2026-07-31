import { getLeaderboard, getUser, getUserRank } from './user-stats';
import { getPoints as getPointsData } from './points';
import { sendChatMessage } from './twitch';
import { sendDiscordMessage } from './discord';
import { getUserCards } from './pokemon-collection';
import { getChatOutputContext } from './chat-output-context';
import { getDiscordStreamHubPoints, getDiscordStreamHubPointsLeaderboard } from './discord-stream-hub';

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

function normalizeTenantId(tenantId?: string): string | undefined {
  if (tenantId?.startsWith('__kick_silent__:')) return tenantId.slice('__kick_silent__:'.length);
  return tenantId;
}

async function handleDiscordPointsCommand(command: string, username: string): Promise<boolean> {
  const context = getChatOutputContext();
  if (!context || context.platform !== 'discord' || !context.channelId) return false;

  const originalCommand = String(context.messageContent || command).trim().toLowerCase();
  const serverId = context.guildId;

  if (originalCommand === '!points') {
    const balance = await getDiscordStreamHubPoints({
      userId: context.userId,
      username: context.username || username,
      displayName: context.displayName || username,
      serverId,
    });
    const rankText = balance.rank ? ` | Rank #${balance.rank}` : '';
    await sendDiscordMessage(
      context.channelId,
      `@${context.displayName || context.username || username} has ${Number(balance.points || 0).toLocaleString()} points${rankText}!`,
    );
    return true;
  }

  if (command === '!pleader' || command === '!leader') {
    const entries = await getDiscordStreamHubPointsLeaderboard({ serverId, limit: 10 });
    if (!entries.length) {
      await sendDiscordMessage(context.channelId, 'No Discord points have been recorded yet.');
      return true;
    }

    const text = entries
      .map((entry, index) => `#${index + 1} ${entry.displayName || entry.username || `User ${index + 1}`} ${Number(entry.points || 0).toLocaleString()}`)
      .join(' | ');
    await sendDiscordMessage(context.channelId, text);
    return true;
  }

  return false;
}

export async function handleLeaderboardCommand(
  command: string,
  username: string,
  args: string,
  broadcast: (message: { type: string; payload: unknown }, tid?: string) => void,
  tenantId?: string,
) {
  if (!checkCooldown(username)) return;

  try {
    if (await handleDiscordPointsCommand(command, username)) return;
  } catch (error) {
    console.error('[Leaderboard] Discord points command failed:', error);
    const context = getChatOutputContext();
    if (context?.platform === 'discord' && context.channelId) {
      await sendDiscordMessage(context.channelId, `@${context.displayName || context.username || username}, I couldn't load Discord points right now.`).catch(() => {});
      return;
    }
  }
  
  const realTenantId = normalizeTenantId(tenantId);
  const tenantCtx = realTenantId ? { tenantId: realTenantId, username: '' } : undefined;

  if (tenantCtx) {
    try {
      const { getStoredTokens } = require('../lib/token-utils.server');
      const tokens = await getStoredTokens(realTenantId);
      if (tokens?.broadcasterUsername) tenantCtx.username = tokens.broadcasterUsername;
    } catch {}
  }

  const user = await getUser(username, tenantCtx);
  const pointsData = await getPointsData(username, tenantCtx);
  const userCards = await getUserCards(username);
  const realTotal = userCards.length;
  const realRare = userCards.filter((c: any) => c.rarity?.includes('Rare')).length;
  
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
    
    broadcast({ type: 'leaderboard-profile', payload: profile }, realTenantId);
    
    const totalHours = Math.floor(user.watchtime / 60);
    let channelUsername = '';
    try {
      const { getStoredTokens: gst } = require('../lib/token-utils.server');
      const t = await gst(realTenantId);
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
      `@${username} | Points: ${pointsData.pointsDisplay} | ${wtStr} | ${cardStr}${badgeList}`,
      'bot', undefined, tenantId
    ).catch(() => {});
    return;
  }
  
  let stat: 'points' | 'watchtime' | 'totalCards' | 'rareCards' | 'badges';
  let statName: string;
  
  switch (command) {
    case '!pleader': stat = 'points'; statName = 'Points'; break;
    case '!wleader': stat = 'watchtime'; statName = 'Watchtime'; break;
    case '!cleader': stat = 'totalCards'; statName = 'Cards'; break;
    case '!bleader': stat = 'badges'; statName = 'Badges'; break;
    case '!bitsleader': stat = 'points'; statName = 'Points'; break;
    default: return;
  }
  
  const leaderboard = await getLeaderboard(stat, 10, tenantCtx);
  const myRank = await getUserRank(username, stat, tenantCtx);
  let myValue = stat === 'badges' ? user.badges.length : user[stat];
  if (stat === 'totalCards') {
    const myCards = await getUserCards(username);
    myValue = myCards.length;
  }
  
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
    }, realTenantId);
    
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
    }, realTenantId);
    
    let chatMsg = `@${username}, you're currently #${myRank} with ${myValue} ${statName.toLowerCase()}!`;
    if (stat === 'watchtime') {
      const totalMin = myValue as number;
      const totalH = Math.floor(totalMin / 60);
      let channelUsername = '';
      try {
        const { getStoredTokens: gst } = require('../lib/token-utils.server');
        const t = await gst(realTenantId);
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
