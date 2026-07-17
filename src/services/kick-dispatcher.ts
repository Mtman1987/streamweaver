/**
 * Kick Chat Dispatcher
 * Routes incoming Kick messages through the command system
 * and sends replies back to Kick chat
 */

import { KickMessage, getKickService } from './kick';
import { getPoints, getPointBalance, setPoints, addPoints, addPointsToAll, setPointsToAll, resetAllPoints, awardChatPoints } from './points';
import { getAllCommands } from '../lib/commands-store';
import { incrementMetric } from './metrics';
import { givePoints, stealPoints } from './points-transfer';
import { handleOneOffTranslation } from './translation-manager';
import type { StorageContext } from './storage';
import { internalServiceHeaders } from '../lib/internal-service-auth';

/**
 * Handle an incoming Kick chat message — process commands and award points
 */
export async function handleKickMessage(msg: KickMessage, tenantId: string) {
  const username = msg.username;
  const displayName = msg.displayName;
  const message = msg.message;
  const isCommand = message.startsWith('!');

  console.log(`[KickDispatcher] Message from ${username}: ${message.slice(0, 100)} (tenant: ${tenantId})`);

  // Community Kick channels are owned by the dedicated chat-tag app now.
  const isCommunityChannel = tenantId.startsWith('kick_community_');
  if (isCommunityChannel) {
    console.log(`[KickDispatcher] Ignoring message for community-only channel ${tenantId}`);
    return;
  }

  if (!isCommunityChannel) {
    try {
      const { getStoredTokens } = require('../lib/token-utils.server');
      const tokens = await getStoredTokens(tenantId);
      if (!tokens?.broadcasterToken || !tokens?.broadcasterRefreshToken) {
        console.log(`[KickDispatcher] Tenant ${tenantId} has no Twitch broadcaster auth; disconnecting Kick and ignoring message.`);
        getKickService(tenantId).disconnect();
        return;
      }
    } catch (e: any) {
      console.warn(`[KickDispatcher] Could not verify tenant auth for ${tenantId}; ignoring Kick message:`, e?.message || e);
      return;
    }
  }

  // Resolve linked Twitch username for points (use Kick username as fallback)
  let pointsUsername = username;
  if (!isCommunityChannel) {
    try {
      const { getLinkedTwitch } = require('./kick-links');
      const linked = await getLinkedTwitch(username, tenantId);
      if (linked) pointsUsername = linked.twitchUsername;
    } catch {}
  }

  // For community channels, use a default tenant for storage fallback
  const effectiveTenantId = isCommunityChannel ? '94371378' : tenantId;
  // Storage context uses broadcaster's channel name (same as Twitch dispatcher)
  // This ensures Kick and Twitch share the same points data folder
  const kickForCtx = getKickService(tenantId);
  const broadcasterName = kickForCtx.getChannelName() || pointsUsername;
  const ctx: StorageContext = { tenantId: effectiveTenantId, username: broadcasterName };

  // Get the kick service for this tenant to send replies
  const kick = getKickService(tenantId);
  const silentTenantId = `__kick_silent__:${tenantId}`;
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
  const isPrivileged = Boolean(msg.isModerator || msg.isOwner || msg.badges?.includes('moderator') || msg.badges?.includes('broadcaster'));
  const denyModsOnly = () => reply(`@${username}, only mods can use that!`);

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

  // Skip bot's own messages (only for tenant channels with tokens)
  if (!isCommunityChannel) {
    const tokens = await kick.loadTokens(tenantId);
    if (tokens && tokens.username && username.toLowerCase() === tokens.username.toLowerCase()) {
      try {
        const tokensFile = require('../lib/tenant').tenantPath(tenantId, 'tokens/kick-tokens.json');
        const raw = JSON.parse(require('fs').readFileSync(tokensFile, 'utf-8'));
        const isBotToken = Boolean(raw.botToken && raw.botUsername);
        if (isBotToken && username.toLowerCase() === (raw.botUsername || '').toLowerCase()) return;
      } catch {}
    }
  }
  // Always skip streamweaverbot's own messages
  if (username.toLowerCase() === 'streamweaverbot') return;

  if (isCommand) {
    incrementMetric('totalCommands', 1, tenantId).catch(() => {});
    const cmdName = message.substring(1).split(' ')[0].toLowerCase();
    const args = message.substring(cmdName.length + 2).trim();

    console.log(`[KickDispatcher] Command: !${cmdName} from ${username} (tenant: ${tenantId})`);

    // Handle core commands
    switch (cmdName) {
      case 'points': {
        const pts = await getPoints(pointsUsername, ctx);
        const linkedNote = pointsUsername !== username ? ` (linked: ${pointsUsername})` : '';
        await reply(`@${username} has ${pts.pointsDisplay} points!${linkedNote}`);
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
      case 't': {
        const translated = await handleOneOffTranslation(args.split(/\s+/).filter(Boolean), tenantId);
        if (translated) await reply(translated);
        return;
      }
      case 'addpoints': {
        if (!isPrivileged) { await denyModsOnly(); return; }
        const parts = args.split(/\s+/);
        const targetUser = parts[0]?.replace('@', '');
        const amount = parseInt(parts[1], 10);
        if (!targetUser || isNaN(amount)) {
          await reply(`@${username}, usage: !addpoints @user amount`);
          return;
        }
        const result = await addPoints(targetUser, amount, 'manual adjustment', ctx);
        await reply(`@${targetUser} now has ${result.points} pts (${amount >= 0 ? '+' : ''}${amount})`);
        return;
      }
      case 'setpoints': {
        if (!isPrivileged) { await denyModsOnly(); return; }
        const parts = args.split(/\s+/);
        const targetUser = parts[0]?.replace('@', '');
        const amount = parseInt(parts[1], 10);
        if (!targetUser || isNaN(amount)) {
          await reply(`@${username}, usage: !setpoints @user amount`);
          return;
        }
        const result = await setPoints(targetUser, amount, ctx);
        await reply(`@${targetUser} set to ${result.points} pts`);
        return;
      }
      case 'addtoall': {
        if (!isPrivileged) { await denyModsOnly(); return; }
        const amount = parseInt(args, 10);
        if (isNaN(amount)) {
          await reply(`@${username}, usage: !addtoall amount`);
          return;
        }
        const count = await addPointsToAll(amount, ctx);
        await reply(`${amount >= 0 ? '+' : ''}${amount} pts to ${count} users!`);
        return;
      }
      case 'settoall': {
        if (!isPrivileged) { await denyModsOnly(); return; }
        const amount = parseInt(args, 10);
        if (isNaN(amount)) {
          await reply(`@${username}, usage: !settoall amount`);
          return;
        }
        const count = await setPointsToAll(amount, ctx);
        await reply(`Set ${count} users to ${amount} pts`);
        return;
      }
      case 'resetallpoints': {
        if (!isPrivileged) { await denyModsOnly(); return; }
        const count = await resetAllPoints(ctx);
        await reply(`Reset points for ${count} users to 0`);
        return;
      }
      case 'givepoints': {
        const parts = args.split(/\s+/);
        const targetUser = parts[0]?.replace('@', '');
        const amount = parseInt(parts[1], 10);
        if (!targetUser || isNaN(amount)) {
          await reply(`@${username}, usage: !givepoints @user amount`);
          return;
        }
        const result = await givePoints(pointsUsername, targetUser, amount, ctx);
        await reply(result.message.replace(`@${pointsUsername}`, `@${username}`));
        return;
      }
      case 'stealpoints': {
        const parts = args.split(/\s+/);
        const targetUser = parts[0]?.replace('@', '');
        const amountText = parts[1] || '';
        const amount = /^\d+$/.test(amountText) ? Number(amountText) : NaN;
        if (!targetUser || !Number.isSafeInteger(amount)) {
          await reply(`@${username}, usage: !stealpoints @user amount`);
          return;
        }
        const result = await stealPoints(pointsUsername, targetUser, amount, ctx);
        await reply(result.message.replace(`@${pointsUsername}`, `@${username}`));
        return;
      }
      case 'gamblemode':
      case 'greetingmode':
      case 'welcomemode':
      case 'clipmode':
      case 'pokemode': {
        if (!isPrivileged) { await reply(`@${username}, only mods can change ${cmdName}!`); return; }
        const { toggleMode } = await import('./modes-manager');
        const modeName = cmdName as 'gamblemode' | 'greetingmode' | 'welcomemode' | 'clipmode' | 'pokemode';
        const toggled = await toggleMode(modeName, tenantId);
        await reply(`${cmdName}: ${toggled.current.toUpperCase()}`);
        return;
      }
      case 'chatmode': {
        if (!isPrivileged) { await reply(`@${username}, only mods can change master chat mode!`); return; }
        const { toggleMasterChatmode, getAllModes } = await import('./modes-manager');
        await toggleMasterChatmode(tenantId);
        const modes = await getAllModes(tenantId);
        await reply(`MASTER MODE: ${modes.chatmode.toUpperCase()} | Gamble(${modes.gamblemode}), Welcome(${modes.welcomemode}), Greeting(${modes.greetingmode}), Clip(${modes.clipmode})`);
        return;
      }
      case 'brb': {
        if (!isPrivileged) return;
        const { startBRB } = require('./brb-clips');
        startBRB(broadcasterName, tenantId).catch((err: any) => console.error('[KickDispatcher] BRB error:', err));
        await reply('Starting BRB clip player...');
        return;
      }
      case 'back': {
        if (!isPrivileged) return;
        const { stopBRB } = require('./brb-clips');
        stopBRB(tenantId);
        if (typeof (global as any).broadcast === 'function') {
          (global as any).broadcast({ type: 'brb-stop' }, tenantId);
          try {
            const { getConfigSection } = require('../lib/local-config/service');
            const obsConfig = await getConfigSection('obs', tenantId);
            const liveScene = obsConfig?.scenes?.live || 'Live';
            (global as any).broadcast({ type: 'obs-switch-scene', payload: { sceneName: liveScene } }, tenantId);
          } catch {}
        }
        await reply('Welcome back!');
        return;
      }
      case 'ignore': {
        if (!isPrivileged) { await reply(`@${username}, only mods can manage the ignore list!`); return; }
        const targetUser = args.replace('@', '').trim().toLowerCase();
        if (!targetUser) {
          await reply(`@${username}, usage: !ignore @username, !ignore all, or !ignore bot name`);
          return;
        }
        if (targetUser === 'all') {
          const { toggleBotTriggerIgnoreAll } = await import('../lib/bot-trigger-ignore-store');
          const config = await toggleBotTriggerIgnoreAll(tenantId);
          await reply(`@${username}, bot trigger ignore-all is ${config.all ? 'ON' : 'OFF'}.`);
          return;
        }
        try {
          const { readWorldLore } = await import('../lib/world-lore-store');
          const { toggleIgnoredBotTrigger } = await import('../lib/bot-trigger-ignore-store');
          const lore = await readWorldLore();
          const characters = Object.values(lore?.characters || {});
          const botCharacter = characters.find((character) => {
            const names = [character.currentName, ...(character.aliases || []), ...(character.previousNames || [])];
            return names.some((name) => name.toLowerCase() === targetUser);
          });
          if (botCharacter) {
            const result = await toggleIgnoredBotTrigger({
              tenantId: botCharacter.stableId.split(':')[0],
              stableId: botCharacter.stableId,
              botName: botCharacter.currentName,
              trigger: targetUser,
            }, tenantId);
            await reply(`@${username}, bot trigger ignore for ${botCharacter.currentName}: ${result.ignored ? 'ON' : 'OFF'}.`);
            return;
          }
        } catch (err) {
          console.warn('[KickDispatcher] Bot trigger ignore lookup failed:', err);
        }
        try {
          const { isKnownBot, addCustomBot, removeCustomBot } = require('./known-bots');
          const currentlyIgnored = await isKnownBot(targetUser, tenantId);
          if (currentlyIgnored) await removeCustomBot(targetUser, tenantId);
          else await addCustomBot(targetUser, tenantId);
          await reply(currentlyIgnored
            ? `@${username}, ${targetUser} removed from ignore list.`
            : `@${username}, ${targetUser} added to ignore list (no welcome/shoutout/points).`);
        } catch (err) {
          console.error('[KickDispatcher] !ignore error:', err);
        }
        return;
      }
      case 'checkin':
      case 'partner':
      case 'crew':
      case 'crewcheckin':
      case 'mod':
      case 'modcheckin':
      case 'spacemountain':
      case 'space':
      case 'spacecheckin': {
        const kindMap: Record<string, 'partner' | 'crew' | 'mod' | 'space-mountain'> = {
          checkin: 'partner',
          partner: 'partner',
          crew: 'crew',
          crewcheckin: 'crew',
          mod: 'mod',
          modcheckin: 'mod',
          spacemountain: 'space-mountain',
          space: 'space-mountain',
          spacecheckin: 'space-mountain',
        };
        const kind = kindMap[cmdName];
        try {
          const { getConfigSection } = require('../lib/local-config/service');
          const { getCheckinSource } = require('./checkin-sources');
          const { formatCheckinList, createPendingPayload, runCheckin, runBulkCheckin } = require('./checkin-flow');
          const redeemsConfig = await getConfigSection('redeems', tenantId);
          const checkinConfigMap: Record<string, any> = {
            partner: redeemsConfig.partnerCheckin,
            crew: redeemsConfig.crewCheckin,
            mod: redeemsConfig.modCheckin,
            'space-mountain': redeemsConfig.spaceMountainCheckin,
          };
          const pointCost = Number(checkinConfigMap[kind]?.pointCost || 0);
          if (pointCost > 0) {
            const { getUserPoints } = require('./points');
            const pts = await getUserPoints(pointsUsername, ctx);
            if (pts < pointCost) {
              await reply(`@${username}, you need ${pointCost} points for this check-in! (You have ${pts})`);
              return;
            }
          }
          const source = await getCheckinSource(kind, tenantId, pointsUsername);
          if (kind === 'space-mountain') {
            await runBulkCheckin('space-mountain', pointsUsername, pointCost, tenantId);
            await reply(`@${username}, space mountain check-in started.`);
            return;
          }
          if (source.entries.length === 0) {
            await reply(`@${username}, no ${source.sourceLabel.toLowerCase()} found right now.`);
            return;
          }
          await reply(formatCheckinList(kind, source.entries));
          const selectionId = parseInt(args, 10);
          if (!selectionId || isNaN(selectionId) || selectionId < 1) {
            const { pendingCheckins } = require('./eventsub');
            if (pendingCheckins) {
              const tenantKey = tenantId || 'global';
              let tenantSelections = pendingCheckins.get(tenantKey);
              if (!tenantSelections) {
                tenantSelections = new Map();
                pendingCheckins.set(tenantKey, tenantSelections);
              }
              tenantSelections.set(pointsUsername.toLowerCase(), { timestamp: Date.now(), kind, pointCost });
              if (typeof (global as any).broadcast === 'function') {
                (global as any).broadcast({ type: 'checkin-pending', payload: createPendingPayload(kind, pointsUsername, source.sourceLabel) }, tenantId);
              }
            }
            return;
          }
          await runCheckin(kind, pointsUsername, selectionId, pointCost, tenantId);
          await reply(`@${username}, check-in submitted.`);
        } catch (err) {
          console.error('[KickDispatcher] check-in command failed:', err);
          await reply(`@${username}, check-in system error! Contact a mod.`);
        }
        return;
      }
      case 'gamble': {
        const { handleGamble } = require('./gamble/classic-gamble');
        const betInput = args;
        const userPts = await getPointBalance(pointsUsername, ctx);
        const result = await handleGamble(pointsUsername, betInput, userPts, silentTenantId);
        if (result) {
          await setPoints(pointsUsername, result.newTotal, ctx);
          const outcomeEmoji = result.outcome === 'jackpot' ? '🎰 JACKPOT!' : result.outcome === 'win' ? '🎉 Win!' : '💀 Loss!';
          await reply(`${outcomeEmoji} @${username} ${result.changeDisplay} points (Total: ${result.newTotalDisplay})`);
        }
        return;
      }
      case 'roll': {
        const { handleRoll } = require('./gamble/classic-gamble');
        const userPts = await getPointBalance(pointsUsername, ctx);
        const result = await handleRoll(pointsUsername, args, userPts, silentTenantId);
        if (result) {
          await setPoints(pointsUsername, result.newTotal, ctx);
          // Store double-or-nothing state for !double (30 second window)
          if (!(global as any).kickDoubleStates) (global as any).kickDoubleStates = new Map();
          (global as any).kickDoubleStates.set(username.toLowerCase(), { wager: result.change.startsWith('-') ? result.change.slice(1) : result.change || args, expires: Date.now() + 30000 });
          await reply(`🎲 @${username} rolled a ${result.roll}! ${result.outcome} (${result.changeDisplay} pts, Total: ${result.newTotalDisplay}) | Type !double to double or nothing!`);
        }
        return;
      }
      case 'double': {
        const states = (global as any).kickDoubleStates as Map<string, any> | undefined;
        const doubleState = states?.get(username.toLowerCase());
        if (!doubleState || Date.now() > doubleState.expires) {
          await reply(`@${username}, no active double-or-nothing available!`);
          return;
        }
        const { handleDouble } = require('./gamble/classic-gamble');
        const dblPts = await getPointBalance(username, ctx);
        const dblResult = await handleDouble(username, doubleState.wager, dblPts, silentTenantId);
        if (dblResult) {
          await setPoints(username, dblResult.newTotal, ctx);
          const dblMsg = dblResult.won
            ? `🎉 @${username} DOUBLE OR NOTHING WIN! ${dblResult.changeDisplay} pts! (Total: ${dblResult.newTotalDisplay})`
            : `💀 @${username} Double or nothing failed. ${dblResult.changeDisplay} pts. (Total: ${dblResult.newTotalDisplay})`;
          await reply(dblMsg);
        }
        states?.delete(username.toLowerCase());
        return;
      }
      case 'collection': {
        const { getUserCards } = require('./pokemon-collection');
        const cards = await getUserCards(pointsUsername);
        if (cards.length === 0) {
          await reply(`@${username}, you don't have any cards yet! Use !pack to open packs.`);
        } else {
          const rareCount = cards.filter((c: any) => c.rarity?.includes('Rare')).length;
          let pokedexUrl = '';
          try {
            const { generatePokedexHtml } = require('./pokedex-html');
            const { getUserCollection } = require('./pokemon-storage-discord');
            const { getConfiguredAppUrl } = require('../lib/runtime-origin');
            const fsSync = require('fs');
            const pathMod = require('path');
            const POKEDEX_DIR = pathMod.join(process.env.PERSIST_ROOT || pathMod.join(process.cwd(), 'data', 'runtime'), 'global', 'pokedex');
            fsSync.mkdirSync(POKEDEX_DIR, { recursive: true });
            const collection = await getUserCollection(pointsUsername);
            const html = await generatePokedexHtml(pointsUsername, cards, collection.packsOpened);
            const key = pointsUsername.toLowerCase();
            fsSync.writeFileSync(pathMod.join(POKEDEX_DIR, `${key}.html`), html);
            pokedexUrl = `${getConfiguredAppUrl()}/api/pokedex?user=${encodeURIComponent(key)}`;
          } catch {}
          const urlPart = pokedexUrl ? ` Pokédex: ${pokedexUrl}` : '';
          await reply(`@${username} has ${cards.length} cards (${rareCount} rare).${urlPart} | !gymteam <set-num> <set-num> <set-num>`);
        }
        return;
      }
      case 'show': {
        const searchName = args.trim().toLowerCase();
        if (!searchName) {
          await reply(`@${username}, usage: !show <card name>`);
          return;
        }
        const path = require('path');
        const fs = require('fs');
        const cardsDir = path.join(process.cwd(), 'pokemon-tcg-data-master', 'cards', 'en');
        const { getUserCards } = require('./pokemon-collection');
        const userCards = await getUserCards(pointsUsername);
        let owned = userCards.filter((c: any) => c.name.toLowerCase() === searchName);
        if (owned.length === 0) owned = userCards.filter((c: any) => c.name.toLowerCase().includes(searchName));
        if (owned.length === 0) {
          await reply(`@${username}, you don't own any card matching "${searchName}".`);
          return;
        }
        const seen = new Set<string>();
        const unique = owned.filter((c: any) => {
          const key = `${c.setCode}-${c.number}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 3);
        for (const card of unique) {
          let tcg: any = null;
          try {
            const setData = JSON.parse(fs.readFileSync(path.join(cardsDir, `${card.setCode}.json`), 'utf-8'));
            tcg = setData.find((c: any) => c.number === card.number);
          } catch {}
          const count = userCards.filter((c: any) => c.number === card.number && c.setCode === card.setCode).length;
          const info = [
            card.name,
            tcg?.level ? `Lv.${tcg.level}` : '',
            `#${card.number}`,
            `Set: ${card.setCode}`,
            card.rarity || 'Common',
            tcg?.hp ? `HP: ${tcg.hp}` : '',
            tcg?.types ? `Type: ${tcg.types.join('/')}` : '',
            tcg?.attacks?.length ? `Attacks: ${tcg.attacks.map((a: any) => `${a.name} (${a.damage || 0})`).join(', ')}` : '',
            `(owned: ${count}x)`,
          ].filter(Boolean).join(' | ');
          await reply(`@${username}: ${info}`);
          if (typeof (global as any).broadcast === 'function') {
            (global as any).broadcast({
              type: 'pokemon-show-card',
              payload: { imageUrl: tcg?.images?.large || card.imageUrl, name: card.name, number: card.number, setCode: card.setCode, rarity: card.rarity, hp: tcg?.hp, types: tcg?.types, level: tcg?.level, attacks: tcg?.attacks, abilities: tcg?.abilities, weaknesses: tcg?.weaknesses, resistances: tcg?.resistances, username: pointsUsername, owned: count }
            }, tenantId);
          }
        }
        return;
      }
      case 'pack': {
        const { getConfigSection } = require('../lib/local-config/service');
        const redeemsConfig = await getConfigSection('redeems', tenantId);
        const pointCost = redeemsConfig.pokePack?.pointCost || 0;
        if (pointCost > 0) {
          const { getUserPoints } = require('./points');
          const pts = await getUserPoints(pointsUsername, ctx);
          if (pts < pointCost) {
            await reply(`@${username}, you need ${pointCost} points to open a pack! (You have ${pts})`);
            return;
          }
        }
        const { getEnabledSetMap, formatSetList } = require('./pokemon-packs');
        const enabledSets = redeemsConfig.pokePack?.enabledSets || [];
        const setMap = getEnabledSetMap(enabledSets);
        const setCount = Object.keys(setMap).length;
        if (setCount === 0) {
          await reply(`@${username}, no Pokemon packs are available!`);
          return;
        }
        const setNumber = parseInt(args, 10);
        if (!setNumber || isNaN(setNumber) || setNumber < 1 || setNumber > setCount) {
          await reply(`${formatSetList(setMap)} | Use !pack 1-${setCount}`);
          return;
        }
        // Open pack silently (suppress Twitch output) and reply to Kick only
        const { handlePackOpenCmd } = require('./eventsub');
        await handlePackOpenCmd(pointsUsername, setNumber, pointCost, silentTenantId);
        // Send result to Kick
        try {
          const { getUserCards } = require('./pokemon-collection');
          const allCards = await getUserCards(pointsUsername);
          const recent = allCards.slice(-9);
          const cardNames = recent.map((c: any) => c.name).join(', ');
          const userPts = await getPoints(pointsUsername, ctx);
          await reply(`@${username} opened a pack: ${cardNames} | Balance: ${userPts.points} pts`);
        } catch {}
        return;
      }
      case 'deck': {
        const { getUserCollection } = require('./pokemon-storage-discord');
        const col = await getUserCollection(pointsUsername);
        if (!col.deck || !col.deck.cards?.length) {
          await reply(`@${username}, you don't have a deck yet. Use the Pokedex deck builder and !setdeck to save one.`);
          return;
        }
        const { getUserCards } = require('./pokemon-collection');
        const cards = await getUserCards(pointsUsername);
        const names = col.deck.cards.slice(0, 8).map((idx: number) => cards[idx - 1]?.name || '?').join(', ');
        const energyStr = Object.entries(col.deck.energy || {}).filter(([, n]) => (n as number) > 0).map(([t, n]) => `${n} ${t}`).join(', ');
        const total = col.deck.cards.length + Object.values(col.deck.energy || {}).reduce((a: number, b: any) => a + Number(b), 0);
        await reply(`@${username}'s deck (${total}/40): ${names}${col.deck.cards.length > 8 ? '...' : ''}${energyStr ? ' | Energy: ' + energyStr : ''}`);
        return;
      }
      case 'setdeck': {
        try {
          const decoded = JSON.parse(Buffer.from(args, 'base64').toString('utf-8'));
          if (!decoded.cards || !Array.isArray(decoded.cards)) throw new Error('bad format');
          const energy: Record<string, number> = decoded.energy || {};
          const energyTotal = Object.values(energy).reduce((a: number, b: any) => a + Number(b), 0);
          const total = decoded.cards.length + energyTotal;
          if (total !== 40) {
            await reply(`@${username}, deck must be exactly 40 cards (got ${total}).`);
            return;
          }
          const { getUserCards } = require('./pokemon-collection');
          const cards = await getUserCards(pointsUsername);
          const invalid = decoded.cards.find((idx: number) => !cards[idx - 1]);
          if (invalid) {
            await reply(`@${username}, card #${invalid} doesn't exist in your collection!`);
            return;
          }
          const { getUserCollection, saveUserCollection } = require('./pokemon-storage-discord');
          const col = await getUserCollection(pointsUsername);
          col.deck = { cards: decoded.cards, energy };
          await saveUserCollection(pointsUsername, col);
          await reply(`@${username}, deck saved! ${decoded.cards.length} cards + ${energyTotal} energy.`);
        } catch {
          await reply(`@${username}, invalid deck code. Use the Pokedex deck builder to generate one.`);
        }
        return;
      }
      case 'gymteam': {
        const teamArgs = args.trim().split(/\s+/).filter(Boolean);
        if (teamArgs.length !== 3 || teamArgs.some((a: string) => !a.includes('-'))) {
          await reply(`@${username}, usage: !gymteam <set-num> <set-num> <set-num>`);
          return;
        }
        const { getUserCards } = require('./pokemon-collection');
        const cards = await getUserCards(pointsUsername);
        const matched = teamArgs.map((id: string) => cards.find((c: any) => `${c.setCode}-${c.number}` === id));
        const missing = teamArgs.filter((_: string, i: number) => !matched[i]);
        if (missing.length) {
          await reply(`@${username}, card(s) not found in your collection: ${missing.join(', ')}`);
          return;
        }
        const { setGymTeam } = require('./gym-team');
        await setGymTeam(pointsUsername, teamArgs);
        await reply(`@${username}, gym team set: ${matched.map((c: any) => `${c.name} (${c.setCode}-${c.number})`).join(', ')}`);
        return;
      }
      case 'so': {
        const targetName = args.trim().replace('@', '');
        if (!targetName) {
          await reply(`@${username}, usage: !so <user>`);
          return;
        }
        try {
          incrementMetric('shoutoutsGiven', 1, tenantId).catch(() => {});
          const { handleWalkOnShoutout } = require('./walk-on-shoutout');
          const profileImage = `https://static-cdn.jtvnw.net/jtv_user_pictures/${targetName}-profile_image-300x300.png`;
          const linkMessage = `Go check out @${targetName} | Twitch: https://twitch.tv/${targetName} | Kick: https://kick.com/${targetName}`;
          await handleWalkOnShoutout(targetName, targetName, profileImage, true, silentTenantId, {
            chatReply: reply,
            linkMessage,
          });
        } catch (err: any) {
          console.error('[KickDispatcher] !so failed:', err);
          await reply(`@${username}, shoutout failed: ${err?.message || 'unknown error'}`);
        }
        return;
      }
      case 'offer': {
        if (!args.trim()) {
          await reply(`@${username}, usage: !offer <name> <number> or !offer <set>-<number>`);
          return;
        }
        const { offerCard } = require('./pokemon-trade-manager');
        await offerCard(pointsUsername, args.trim(), silentTenantId);
        await reply(`@${username}, offer received.`);
        return;
      }
      case 'accept': {
        const { acceptSwap, hasPendingSwap } = require('./pokemon-swap');
        if (hasPendingSwap(pointsUsername, silentTenantId)) {
          const accepted = await acceptSwap(pointsUsername, silentTenantId);
          await reply(accepted ? `@${username}, swap accepted.` : `@${username}, no pending swap found.`);
          return;
        }
        const { acceptTrade } = require('./pokemon-trade-manager');
        await acceptTrade(pointsUsername, silentTenantId);
        await reply(`@${username}, trade accept received.`);
        return;
      }
      case 'cancel': {
        const { cancelSwap, hasPendingSwap } = require('./pokemon-swap');
        if (hasPendingSwap(pointsUsername, silentTenantId)) {
          const cancelled = await cancelSwap(pointsUsername, silentTenantId);
          await reply(cancelled ? `@${username}, swap cancelled.` : `@${username}, no pending swap found.`);
          return;
        }
        const { cancelTrade } = require('./pokemon-trade-manager');
        await cancelTrade(pointsUsername, silentTenantId);
        await reply(`@${username}, trade cancel received.`);
        return;
      }
      case 'swap': {
        const parts = args.trim().match(/^@?(\S+)\s+(\d+)\s+for\s+(\d+)$/i);
        if (!parts) {
          await reply(`@${username}, usage: !swap @user <your card#> for <their card#>`);
          return;
        }
        const targetUser = parts[1].replace('@', '');
        const myCard = parseInt(parts[2], 10);
        const theirCard = parseInt(parts[3], 10);
        if (targetUser.toLowerCase() === pointsUsername.toLowerCase()) {
          await reply(`@${username}, you can't swap with yourself!`);
          return;
        }
        const { proposeSwap } = require('./pokemon-swap');
        await proposeSwap(pointsUsername, targetUser, myCard, theirCard, silentTenantId);
        await reply(`@${username} proposed a swap with @${targetUser}. @${targetUser} type !accept or !cancel.`);
        return;
      }
      case 'challenge': {
        const { joinQueue } = require('./gym-battle');
        await joinQueue(pointsUsername, silentTenantId);
        await reply(`@${username}, you joined the gym queue.`);
        return;
      }
      case 'testswap': {
        if (!isPrivileged) return;
        const { proposeSwap, acceptSwap } = require('./pokemon-swap');
        await proposeSwap(pointsUsername, 'akhiteddy', 1, 1, silentTenantId);
        setTimeout(async () => {
          await acceptSwap('akhiteddy', silentTenantId);
        }, 5000);
        await reply(`@${username}, test swap started.`);
        return;
      }
      case 'testgym': {
        if (!isPrivileged) return;
        const { testGymBattle } = require('./gym-battle');
        await testGymBattle(silentTenantId);
        await reply(`@${username}, test gym battle queued.`);
        return;
      }
      case 'nextchallenger': {
        if (!isPrivileged) {
          await reply(`@${username}, only the gym leader can start battles!`);
          return;
        }
        const { startNextBattle } = require('./gym-battle');
        await startNextBattle(silentTenantId);
        await reply(`@${username}, starting the next challenger.`);
        return;
      }
      case 'attack': {
        const { battleAttack } = require('./gym-battle');
        await battleAttack(pointsUsername, silentTenantId);
        await reply(`@${username}, attack submitted.`);
        return;
      }
      case 'switch': {
        const { battleSwitch } = require('./gym-battle');
        await battleSwitch(pointsUsername, silentTenantId);
        await reply(`@${username}, switch submitted.`);
        return;
      }
      case 'link': {
        if (!args) {
          await reply(`@${username}, type !link @your_twitch_username to link your Kick account to your Twitch for points & commands.`);
          return;
        }
        const twitchName = args.split(/\s+/)[0].replace('@', '').toLowerCase();
        if (!/^[a-z0-9_]{3,25}$/i.test(twitchName)) {
          await reply(`@${username}, usage: !link @your_twitch_username`);
          return;
        }
        let twitchId = `username:${twitchName}`;
        let twitchLogin = twitchName;
        let twitchDisplayName = twitchName;
        try {
          const { getStoredTokens, ensureValidToken } = require('../lib/token-utils.server');
          const { getConfigSection } = require('../lib/local-config/service');
          const twitchConfig = await getConfigSection('twitch', tenantId);
          const storedTokens = await getStoredTokens(tenantId);
          const token = await ensureValidToken(twitchConfig.clientId, twitchConfig.clientSecret, 'broadcaster', storedTokens, tenantId);
          const res = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(twitchName)}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Client-ID': twitchConfig.clientId },
          });
          if (res.ok) {
            const data = await res.json();
            const user = data.data?.[0];
            if (user) {
              twitchId = user.id;
              twitchLogin = user.login;
              twitchDisplayName = user.display_name || user.login;
            }
          } else {
            console.warn(`[KickDispatcher] Twitch lookup failed for !link ${twitchName}: ${res.status}`);
          }
        } catch (e: any) {
          console.warn('[KickDispatcher] !link Twitch lookup skipped:', e?.message || e);
        }
        try {
          const { linkKickToTwitch } = require('./kick-links');
          await linkKickToTwitch(username, twitchId, twitchLogin, tenantId);
          await reply(`✅ @${username}, your Kick account is now linked to Twitch: ${twitchDisplayName}. Points & commands will sync!`);
        } catch (e: any) {
          console.error('[KickDispatcher] !link error:', e);
          await reply(`@${username}, link failed. Try again later.`);
        }
        return;
      }
      case 'unlink': {
        const { unlinkKick } = require('./kick-links');
        const removed = await unlinkKick(username, tenantId);
        await reply(removed ? `✅ @${username}, Kick account unlinked.` : `@${username}, no linked account found.`);
        return;
      }
      case 'commands': {
        await reply('Fun: !hug,!boop,!cuddle,!dance,!highfive,!lurk,!unlurk | Games: !gamble,!roll,!double,!coinflip | Pokemon: !pack,!collection,!show,!deck,!setdeck,!gymteam | Info: !points,!time,!watchtime,!leader,!pleader,!wleader,!cleader | Mods: !admin | Kick: !link,!unlink');
        return;
      }
      case 'admin': {
        if (isPrivileged) {
          await reply('Admin: !addpoints,!setpoints,!addtoall,!settoall,!resetallpoints,!gamblemode,!greetingmode,!welcomemode,!clipmode,!pokemode,!chatmode,!bic remove|blacklist|unblacklist');
        } else {
          await reply(`@${username}, only mods can view admin commands!`);
        }
        return;
      }
      case 'leader': {
        const { handleLeaderboardCommand } = require('./leaderboard-commands');
        const broadcastFn = typeof (global as any).broadcast === 'function' ? (global as any).broadcast : () => {};
        await handleLeaderboardCommand('!leader', pointsUsername, '', broadcastFn, silentTenantId);
        // Get leaderboard data and reply to Kick
        try {
          const { getLeaderboard } = require('./points');
          const lb = await getLeaderboard(5, ctx);
          const top5 = lb.slice(0, 5).map((e: any, i: number) => `#${i+1} ${e.user}: ${e.points}`).join(' | ');
          await reply(`🏆 ${top5 || 'No data'}`);
        } catch { await reply(`🏆 Leaderboard unavailable`); }
        return;
      }
      case 'pleader':
      case 'wleader':
      case 'cleader':
      case 'bleader':
      case 'bitsleader': {
        try {
          const { getLeaderboard: getStatsLeaderboard, getUser, getUserRank } = require('./user-stats');
          const { getUserCards } = require('./pokemon-collection');
          const statMap: Record<string, { stat: 'points' | 'watchtime' | 'totalCards' | 'badges'; name: string }> = {
            pleader: { stat: 'points', name: 'points' },
            wleader: { stat: 'watchtime', name: 'watchtime' },
            cleader: { stat: 'totalCards', name: 'cards' },
            bleader: { stat: 'badges', name: 'badges' },
            bitsleader: { stat: 'points', name: 'points' },
          };
          const spec = statMap[cmdName];
          const tenantStatsCtx = { tenantId, username: broadcasterName };
          const user = await getUser(pointsUsername, tenantStatsCtx);
          const rank = await getUserRank(pointsUsername, spec.stat, tenantStatsCtx);
          let value: any = spec.stat === 'badges' ? user.badges.length : user[spec.stat];
          if (spec.stat === 'totalCards') value = (await getUserCards(pointsUsername)).length;
          const top = await getStatsLeaderboard(spec.stat, 5, tenantStatsCtx);
          const topText = top.map((u: any, i: number) => {
            const v = spec.stat === 'badges' ? u.badges.length : u[spec.stat];
            return `#${i + 1} ${u.user}: ${v}`;
          }).join(' | ');
          await reply(`@${username}, you're #${rank} with ${value} ${spec.name}. Top: ${topText || 'No data'}`);
        } catch {
          await reply(`Leaderboard unavailable`);
        }
        return;
      }
      case 'watchtime': {
        try {
          const { getUser, formatWatchtime } = require('./user-stats');
          const user = await getUser(pointsUsername, { tenantId, username: broadcasterName });
          await reply(formatWatchtime(user).replace(`@${pointsUsername}`, `@${username}`));
        } catch {
          await reply(`@${username}, couldn't fetch your watchtime!`);
        }
        return;
      }
      case 'sr': {
        await reply(message);
        return;
      }
      case 'bic': {
        try {
          const { getBicData, stealLighter, removeLighter, getVictimList, isBlacklisted, addToBlacklist, removeFromBlacklist } = require('./bic-storage');
          const bicArgs = args.trim();
          if (!bicArgs || bicArgs.toLowerCase().startsWith('list')) {
            const data = getBicData();
            const victims = getVictimList();
            if (victims.length === 0) { await reply('No lighters have been stolen yet!'); return; }
            const pageArg = bicArgs ? parseInt(bicArgs.replace(/^list\s*/i, ''), 10) : 1;
            const page = (isNaN(pageArg) || pageArg < 1) ? 1 : pageArg;
            const pageSize = 10;
            const totalPages = Math.ceil(victims.length / pageSize);
            const list = victims.slice((page - 1) * pageSize, page * pageSize).map((v: { name: string; count: number }) => `${v.name}: ${v.count}`).join(', ');
            await reply(`${data.total} lighters stolen! Victims: ${list}${totalPages > 1 ? ` (pg ${page}/${totalPages})` : ''}`);
            return;
          }
          if (bicArgs.toLowerCase().startsWith('remove ')) {
            if (!isPrivileged) { await reply(`@${username}, only mods can remove bic entries!`); return; }
            const target = bicArgs.substring(7).trim().replace('@', '').toLowerCase();
            if (!target) { await reply(`@${username}, usage: !bic remove @user`); return; }
            const { total, userCount } = removeLighter(target);
            await reply(`Removed 1 lighter from ${target}. Total: ${total}, ${target}: ${userCount}`);
            return;
          }
          if (bicArgs.toLowerCase().startsWith('blacklist ')) {
            if (!isPrivileged) { await reply(`@${username}, only mods can manage the bic blacklist!`); return; }
            const target = bicArgs.substring(10).trim().replace('@', '').toLowerCase();
            await reply(addToBlacklist(target) ? `${target} added to bic blacklist` : `${target} is already blacklisted`);
            return;
          }
          if (bicArgs.toLowerCase().startsWith('unblacklist ')) {
            if (!isPrivileged) { await reply(`@${username}, only mods can manage the bic blacklist!`); return; }
            const target = bicArgs.substring(12).trim().replace('@', '').toLowerCase();
            await reply(removeFromBlacklist(target) ? `${target} removed from bic blacklist` : `${target} is not blacklisted`);
            return;
          }
          const target = bicArgs.replace('@', '').toLowerCase();
          if (isBlacklisted(target)) { await reply(`@${username}, ${target} is protected from lighter theft!`); return; }
          const { total, userCount } = stealLighter(target);
          await reply(`fatkid4ev4 has stolen ${total} lighters, of those ${userCount} have been ${target}'s`);
          try {
            const { publishBicOverlay } = require('./bic-service');
            await publishBicOverlay({ total, lastUser: target, lastUserCount: userCount });
          } catch {}
        } catch (err) {
          console.error('[KickDispatcher] !bic error:', err);
        }
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
          'cuddle': '{user} cuddles up with {target} in a cozy embrace 🥰',
          'dance': '{user} dances with {target}! 💃🕺',
          'fistbump': '{user} gives {target} an epic fist bump! 👊',
          'headpat': '{user} gently pats {target} on the head',
          'highfive': '{user} high-fives {target}! ✋',
          'love': '{user} sends love to {target}! ❤️',
          'tickle': '{user} tickles {target}!',
          'lurk': '{user} is lurking 👀',
          'unlurk': '{user} is back! 👋',
          'hydrate': 'Time to hydrate! Stay healthy, chat!',
          'stretch': 'Stretch break! Take care of your body!',
          'yes': 'Yes!',
          'yup': 'Yup!',
          'no': 'Nope!',
          'hover': '{user} hovers mysteriously',
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
    // Non-command message — award chat points (skip for community channels)
    if (!isCommunityChannel) {
      awardChatPoints(username, ctx).catch(() => {});
    }
  }

  // Check if message mentions the bot (AI response) — skip for community channels
  if (isCommunityChannel) return;
  try {
    const { getBotName, getBotAliases } = require('../lib/bot-settings-store');
    const botName = getBotName(tenantId);
    const aliases = (getBotAliases(tenantId) || '').toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean);
    const triggers = [botName.toLowerCase(), ...aliases];
    const lowerMsg2 = message.toLowerCase();

    console.log(`[KickDispatcher] AI check — botName: "${botName}", aliases: [${triggers.join(', ')}], msg: "${lowerMsg2.slice(0, 50)}"`);

    if (triggers.some(t => t && lowerMsg2.includes(t))) {
      console.log(`[KickDispatcher] AI triggered by "${triggers.find(t => t && lowerMsg2.includes(t))}" in message from ${username}`);
      incrementMetric('athenaCommands', 1, tenantId).catch(() => {});
      const PORT = process.env.PORT || 3100;
      const res = await fetch(`http://127.0.0.1:${PORT}/api/ai/chat-with-memory`, {
        method: 'POST',
        headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username, message, tenantId, context: 'kick' }),
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[KickDispatcher] AI response: ${(data.response || '').slice(0, 80)}`);
        if (data.response?.trim()) {
          const aiReply = data.response.trim();
          await reply(aiReply);

          // Generate TTS for AI response (same as Twitch dispatcher)
          try {
            const { textToSpeech } = await import('../ai/flows/text-to-speech');
            const ttsResult = await textToSpeech({ text: aiReply, tenantId });
            if (ttsResult.audioDataUri) {
              const tenantQuery = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
              await fetch(`http://127.0.0.1:${PORT}/api/tts/current${tenantQuery}`, {
                method: 'POST',
                headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ audioUrl: ttsResult.audioDataUri })
              }).catch(err => console.error('[KickDispatcher] TTS queue failed:', err));
              if (typeof (global as any).broadcast === 'function') {
                const broadcast = (global as any).broadcast;
                broadcast({ type: 'play-tts', payload: { audioDataUri: ttsResult.audioDataUri } }, tenantId);
                try {
                  const { showTalkingAvatar, hideAvatarAfterDelay } = require('../server/avatar');
                  showTalkingAvatar(broadcast, tenantId);
                  hideAvatarAfterDelay(12000, broadcast, tenantId);
                } catch (avatarErr) {
                  console.error('[KickDispatcher] Avatar trigger failed:', avatarErr);
                }
              }
            }
          } catch (err) {
            console.error('[KickDispatcher] TTS generation failed:', err);
          }
        }
      } else {
        console.warn(`[KickDispatcher] AI endpoint returned ${res.status}: ${await res.text().catch(() => '')}`);
      }
    }
  } catch (e) {
    console.error('[KickDispatcher] AI mention check failed:', e);
  }
}
