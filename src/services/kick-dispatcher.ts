/**
 * Kick Chat Dispatcher
 * Routes incoming Kick messages through the command system
 * and sends replies back to Kick chat
 */

import { KickMessage, getKickService } from './kick';
import { getPoints, setPoints, addPoints, awardChatPoints } from './points';
import { getAllCommands } from '../lib/commands-store';
import { incrementMetric } from './metrics';
import type { StorageContext } from './storage';

/**
 * Handle an incoming Kick chat message — process commands and award points
 */
export async function handleKickMessage(msg: KickMessage, tenantId: string) {
  const username = msg.username;
  const displayName = msg.displayName;
  const message = msg.message;
  const isCommand = message.startsWith('!');

  const ctx: StorageContext = { tenantId, username };

  // Get the kick service for this tenant to send replies
  const kick = getKickService(tenantId);
  const reply = async (text: string) => {
    try {
      await kick.sendChatMessage(text);
    } catch (e) {
      console.warn('[KickDispatcher] ⚠️ Could not reply to Kick, falling back to Twitch');
      // Fallback: send to Twitch chat
      try {
        const { sendChatMessage } = require('./twitch');
        await sendChatMessage(`[Kick] ${text}`, 'bot', undefined, tenantId);
      } catch {}
    }
  };

  // Broadcast to WebSocket for unified chat display
  if (typeof (global as any).broadcast === 'function') {
    (global as any).broadcast({
      type: 'twitch-message',
      payload: {
        platform: 'kick',
        username,
        displayName,
        message,
        timestamp: msg.timestamp.toISOString(),
        badges: msg.badges,
      }
    }, tenantId);
  }

  // Skip bot's own messages
  const tokens = await kick.loadTokens(tenantId);
  if (tokens && username.toLowerCase() === tokens.username.toLowerCase()) return;

  if (isCommand) {
    incrementMetric('totalCommands').catch(() => {});
    const cmdName = message.substring(1).split(' ')[0].toLowerCase();
    const args = message.substring(cmdName.length + 2).trim();

    console.log(`[KickDispatcher] Command: !${cmdName} from ${username} (tenant: ${tenantId})`);

    // Handle core commands
    switch (cmdName) {
      case 'points': {
        const pts = await getPoints(username, ctx);
        await reply(`@${username} has ${pts.points} points!`);
        return;
      }
      case 'coinflip': {
        const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
        await reply(`@${username} flipped a coin: ${result}! 🪙`);
        return;
      }
      case 'time': {
        const now = new Date();
        const pst = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
        const est = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
        const utc = now.toLocaleString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
        await reply(`🕐 PST: ${pst} | EST: ${est} | UTC: ${utc}`);
        return;
      }
      case 'gamble': {
        const { handleGamble } = require('./gamble/classic-gamble');
        const betInput = args;
        const userPts = await getPoints(username, ctx);
        const result = await handleGamble(username, betInput, userPts.points, tenantId);
        if (result) await setPoints(username, result.newTotal, ctx);
        return;
      }
      case 'roll': {
        const { handleRoll } = require('./gamble/classic-gamble');
        const userPts = await getPoints(username, ctx);
        const result = await handleRoll(username, args, userPts.points, tenantId);
        if (result) await setPoints(username, result.newTotal, ctx);
        return;
      }
      case 'collection': {
        const { getUserCards } = require('./pokemon-collection');
        const cards = await getUserCards(username);
        if (cards.length === 0) {
          await reply(`@${username}, you don't have any cards yet! Use !pack to open packs.`);
        } else {
          const rareCount = cards.filter((c: any) => c.rarity?.includes('Rare')).length;
          await reply(`@${username} has ${cards.length} cards (${rareCount} rare).`);
        }
        return;
      }
      case 'pack': {
        const { getConfigSection } = require('../lib/local-config/service');
        const redeemsConfig = await getConfigSection('redeems', tenantId);
        const pointCost = redeemsConfig.pokePack?.pointCost || 0;
        if (pointCost > 0) {
          const { getUserPoints } = require('./points');
          const pts = await getUserPoints(username, ctx);
          if (pts < pointCost) {
            await reply(`@${username}, you need ${pointCost} points to open a pack! (You have ${pts})`);
            return;
          }
        }
        const { getEnabledSetMap, formatSetList } = require('./pokemon-packs');
        const enabledSets = redeemsConfig.pokePack?.enabledSets || ['base1', 'base2', 'base3'];
        const setMap = getEnabledSetMap(enabledSets);
        const setCount = Object.keys(setMap).length;
        if (setCount === 0) {
          await reply(`@${username}, no Pokemon packs are available!`);
          return;
        }
        const setNumber = parseInt(args, 10);
        if (!setNumber || isNaN(setNumber) || setNumber < 1 || setNumber > setCount) {
          await reply(formatSetList(setMap));
          return;
        }
        const { handlePackOpenCmd } = require('./eventsub');
        await handlePackOpenCmd(username, setNumber, pointCost, tenantId);
        return;
      }
      case 'commands': {
        await reply('🎮 !points, !gamble, !roll, !coinflip, !pack, !collection, !time');
        return;
      }
      case 'leader': {
        const { handleLeaderboardCommand } = require('./leaderboard-commands');
        const broadcastFn = typeof (global as any).broadcast === 'function' ? (global as any).broadcast : () => {};
        await handleLeaderboardCommand('!leader', username, '', broadcastFn, tenantId);
        return;
      }
      default: {
        // Check custom commands
        const commands = await getAllCommands(tenantId);
        const command = commands.find((c: any) =>
          String(c.command || '').toLowerCase().replace(/^!/, '') === cmdName && c.enabled !== false
        );
        if (command && (command as any).response) {
          await reply((command as any).response);
          return;
        }
        // Social commands
        const socialCommands: Record<string, string> = {
          'hug': '{user} wraps {target} in a warm hug 🤗',
          'boop': '{user} boops {target}! 👉',
          'dance': '{user} dances with {target}! 💃🕺',
          'highfive': '{user} high-fives {target}! ✋',
          'lurk': '{user} is lurking 👀',
          'unlurk': '{user} is back! 👋',
        };
        if (socialCommands[cmdName]) {
          const target = args || 'someone';
          const response = socialCommands[cmdName].replace('{user}', username).replace('{target}', target);
          await reply(response);
          return;
        }
      }
    }
  } else {
    // Non-command message — award chat points
    awardChatPoints(username, ctx).catch(() => {});
  }

  // Check if message mentions the bot (AI response)
  try {
    const { getBotName, getBotAliases } = require('../lib/bot-settings-store');
    const botName = getBotName(tenantId);
    const aliases = (getBotAliases(tenantId) || '').toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean);
    const triggers = [botName.toLowerCase(), ...aliases];
    const lowerMsg = message.toLowerCase();

    if (triggers.some(t => lowerMsg.includes(t))) {
      incrementMetric('athenaCommands').catch(() => {});
      const PORT = process.env.PORT || 3100;
      const res = await fetch(`http://127.0.0.1:${PORT}/api/ai/chat-with-memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, message, tenantId, context: 'kick' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.response?.trim()) {
          await reply(data.response.trim());
        }
      }
    }
  } catch (e) {
    console.error('[KickDispatcher] AI mention check failed:', e);
  }
}
