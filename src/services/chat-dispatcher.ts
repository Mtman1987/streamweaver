import { getAllCommands } from '../lib/commands-store';
import { getActionById } from '../lib/actions-store';
import { runFlowGraph, defaultFlowServices } from '../lib/flow-runtime';
import { sendDiscordMessage } from './discord';
import { sendChatMessage } from './twitch';
import { awardChatPoints } from './points';
import { givePoints, stealPoints } from './points-transfer';
import { shouldWelcomeUser, markUserWelcomed, getWelcomeMode } from './welcome-wagon';
import { handleWalkOnShoutout } from './walk-on-shoutout';
import { handleVoiceShoutout } from './voice-shoutout';
import { autoTranslateIncoming, isTranslationActive, handleOneOffTranslation } from './translation-manager';
import { handleLeaderboardCommand } from './leaderboard-commands';
import { handleBingoCard, handleBingoPhrases, handleClaimSquare, handleNewBingoGame, handleOverride, checkForBingoPhrase, athenaClaimCheck } from './bingo';
import { startBRB, stopBRB, toggleClipMode, getClipMode } from './brb-clips';
import { handleGamble as handleClassicGamble, handleRoll, handleDouble } from './gamble/classic-gamble';
import { getPoints, setPoints } from './points';
import { getAIConfig } from './ai-provider';
import * as fs from 'fs/promises';
import { resolve } from 'path';

// Track processed messages to prevent duplicates
const processedMessages = new Set<string>();

// Track messages that already have TTS (e.g. from shoutout flow) to prevent double TTS
const ttsHandledMessages = new Set<string>();

export function markTtsHandled(message: string) {
    ttsHandledMessages.add(message.slice(0, 100));
    // Auto-cleanup after 10 seconds
    setTimeout(() => ttsHandledMessages.delete(message.slice(0, 100)), 10000);
}

// Pagination state for card listings
const cardListings = new Map<string, { cards: string[], page: number }>();

async function getDiscordLogChannelId(): Promise<string | null> {
    try {
        const p = resolve(process.cwd(), 'tokens', 'discord-channels.json');
        const data = await fs.readFile(p, 'utf-8');
        const config = JSON.parse(data);
        // Check if Discord bridge is enabled
        if (config.discordBridgeEnabled === false) {
            return null;
        }
        return config.logChannelId;
    } catch { return null; }
}

export async function handleTwitchMessage(channel: string, tags: any, message: string, self: boolean) {
    const username = tags.username!;
    const displayName = tags['display-name'] || username;
    
    // Prevent duplicate processing with more specific ID
    const messageId = `${tags.id || 'no-id'}-${username}-${message.slice(0, 50)}`;
    
    if (processedMessages.has(messageId)) {
        console.log(`[Dispatcher] Skipping duplicate message: ${messageId}`);
        return;
    }
    processedMessages.add(messageId);
    
    // Also check for recent identical messages
    const contentKey = `${username}-${message}`;
    const now = Date.now();
    const recentMessages = (global as any).recentMessages || new Map();
    
    if (recentMessages.has(contentKey)) {
        const lastTime = recentMessages.get(contentKey);
        if (now - lastTime < 5000) { // 5 second window
            console.log(`[Dispatcher] Skipping recent duplicate content from ${username}`);
            return;
        }
    }
    recentMessages.set(contentKey, now);
    (global as any).recentMessages = recentMessages;
    
    // Clean up old message IDs (keep last 100)
    if (processedMessages.size > 100) {
        const oldIds = Array.from(processedMessages).slice(0, processedMessages.size - 100);
        oldIds.forEach(id => processedMessages.delete(id));
    }
    
    // Track chat messages for redemptions (before any other processing)
    let consumedByRedemption = false;
    if (!self && !message.startsWith('!') && !message.startsWith('[')) {
        const { trackChatMessageForRedemption } = require('./eventsub');
        consumedByRedemption = trackChatMessageForRedemption(username, message);
    }
    
    // Extract actual message if it came from Discord
    let actualMessage = message;
    let actualUsername = username;
    if (message.startsWith('[Discord] ')) {
        const match = message.match(/^\[Discord\]\s+([^:]+):\s+(.+)$/);
        if (match) {
            actualUsername = match[1].trim();
            actualMessage = match[2];
            console.log(`[Dispatcher] Extracted Discord message - user: ${actualUsername}, message: ${actualMessage}`);
        } else {
            console.log(`[Dispatcher] Failed to parse Discord message: ${message}`);
        }
    }
    
    const isCommand = actualMessage.startsWith('!');
    
    // Get usernames from stored tokens (OAuth source of truth), then user config as fallback
    let botUsername = 'streamweaverbot';
    let broadcasterUsername = 'broadcaster';
    try {
        const { readUserConfigSync } = require('../lib/user-config');
        const config = readUserConfigSync();
        broadcasterUsername = config.TWITCH_BROADCASTER_USERNAME || 'broadcaster';
        botUsername = config.TWITCH_BOT_USERNAME || 'streamweaverbot';
    } catch {}
    try {
        const fs = require('fs');
        const path = require('path');
        const tokensPath = path.join(process.cwd(), 'tokens', 'twitch-tokens.json');
        if (fs.existsSync(tokensPath)) {
            const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
            if (tokens.botUsername) botUsername = tokens.botUsername;
            if (tokens.broadcasterUsername) broadcasterUsername = tokens.broadcasterUsername;
        }
    } catch {}
    
    const isBot = actualUsername.toLowerCase() === botUsername.toLowerCase();
    const isBotMessage = actualUsername.toLowerCase() === botUsername.toLowerCase(); // Only actual bot messages

    console.log(`[Dispatcher] Handling Twitch message: "${message}" from ${displayName} (self: ${self}, isBot: ${isBot}, isBotMessage: ${isBotMessage})`);
    
    // Skip self messages (broadcaster client echoes its own sends)
    if (self) return;
    
    // Allow !t translation commands from broadcaster/mods before other checks
    if (isCommand && actualMessage.toLowerCase().startsWith('!t ')) {
        const args = actualMessage.substring(3).trim().split(/\s+/);
        const translated = await handleOneOffTranslation(args);
        if (translated) {
            await sendChatMessage(translated, 'bot').catch(() => {});
        }
        return;
    }
    
    // Skip processing bot's own messages to prevent loops
    if (isBotMessage) {
        // Check if TTS was already handled (e.g. by shoutout flow)
        const msgKey = actualMessage.slice(0, 100);
        if (ttsHandledMessages.has(msgKey)) {
            console.log(`[Dispatcher] Bot message TTS already handled, skipping: ${actualMessage.substring(0, 50)}`);
            ttsHandledMessages.delete(msgKey);
            return;
        }
        
        console.log(`[Dispatcher] Bot message detected, generating TTS for: ${actualMessage.substring(0, 50)}`);
        
        // Generate TTS for bot messages only
        try {
            const { textToSpeech } = await import('../ai/flows/text-to-speech');
            const ttsResult = await textToSpeech({ text: actualMessage, voice: 'Algieba' });
            
            if (ttsResult.audioDataUri) {
                const useTTSPlayer = process.env.USE_TTS_PLAYER !== 'false';
                console.log('[Dispatcher] TTS generated for bot message, USE_TTS_PLAYER:', useTTSPlayer);
                
                if (useTTSPlayer) {
                    await fetch('http://127.0.0.1:3100/api/tts/current', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ audioUrl: ttsResult.audioDataUri })
                    }).catch(err => console.error('[Dispatcher] Failed to send TTS to player:', err));
                    
                    if (typeof (global as any).broadcast === 'function') {
                        (global as any).broadcast({
                            type: 'play-tts',
                            payload: { audioDataUri: ttsResult.audioDataUri }
                        });
                    }
                } else {
                    if (typeof (global as any).broadcast === 'function') {
                        (global as any).broadcast({
                            type: 'play-tts',
                            payload: { audioDataUri: ttsResult.audioDataUri }
                        });
                    }
                }
            }
        } catch (err) {
            console.error('[Dispatcher] TTS generation failed for bot message:', err);
        }
        
        return;
    }
    // Check for bingo phrases in ALL messages
    await checkForBingoPhrase(actualMessage, actualUsername);
    
    // Skip auto-translation for messages that start with [ to prevent loops
    if (!self && !message.startsWith('[') && (isTranslationActive() || require('./translation-manager').isUserAutoTranslate(actualUsername))) {
        const translated = await autoTranslateIncoming(actualMessage, actualUsername);
        if (translated) {
            console.log(`[Dispatcher] Auto-translated incoming: ${translated}`);
            // Show translation in chat as bot to prevent loops
            await sendChatMessage(`[${actualUsername}]: ${translated}`, 'bot').catch(() => {});
        }
    }
    
    // Bridge to Discord (skip if message came from Discord to avoid loop)
    if (!message.startsWith('[')) {
        const logChannelId = await getDiscordLogChannelId();
        if (logChannelId) {
            console.log(`[Dispatcher] Bridging to Discord: ${message}`);
            await sendDiscordMessage(logChannelId, `**[Twitch] ${displayName}:** ${message}`).catch(() => {});
        } else {
            console.log(`[Dispatcher] Discord bridge disabled or no channel configured`);
        }
    } else {
        console.log(`[Dispatcher] Skipping Discord bridge for message starting with [`);
    }

    if (isCommand && !isBot) {
        // Handle !show command for Pokemon cards (BEFORE command store check)
        if (actualMessage.toLowerCase().startsWith('!show ')) {
          const args = actualMessage.substring(6).trim().split(/\s+/);
          const cardQuery = args[0];
          const setFilter = args[1]?.toLowerCase() || null;
          
          if (!cardQuery) {
            await sendChatMessage(`@${actualUsername}, usage: !show <card name or number> [set]`, 'bot').catch(() => {});
            return;
          }
          
          const path = require('path');
          const fs = require('fs');
          const CARDS_DB_DIR = path.join(process.cwd(), 'pokemon-tcg-data-master', 'cards', 'en');
          const files = fs.readdirSync(CARDS_DB_DIR).filter((f: string) => f.endsWith('.json'));
          const isNumber = /^\d+$/.test(cardQuery);
          const searchName = cardQuery.toLowerCase();
          const matches: any[] = [];
          
          for (const file of files) {
            const setCode = file.replace('.json', '');
            if (setFilter && setCode !== setFilter) continue;
            
            try {
              const cardData = JSON.parse(fs.readFileSync(path.join(CARDS_DB_DIR, file), 'utf-8'));
              const cards = isNumber 
                ? cardData.filter((c: any) => c.number === cardQuery)
                : cardData.filter((c: any) => c.name && c.name.toLowerCase() === searchName);
              
              cards.forEach((card: any) => {
                matches.push({ ...card, setCode });
              });
            } catch (err) {
              console.error(`[Dispatcher] Error reading card file ${file}:`, err);
            }
          }
          
          if (matches.length === 0) {
            await sendChatMessage(`@${actualUsername}, card not found!`, 'bot').catch(() => {});
            return;
          }
          
          const { getUserCards } = require('./pokemon-collection');
          const userCards = await getUserCards(actualUsername);
          
          // If more than 5 cards, create file and upload to Discord
          if (matches.length > 5) {
            const fileContent = matches.map(card => {
              const owned = userCards.filter((c: any) => c.number === card.number && c.setCode === card.setCode).length;
              return [
                card.name,
                card.level ? `Lv.${card.level}` : '',
                `#${card.number}`,
                `Set: ${card.setCode}`,
                card.rarity || 'Common',
                card.hp ? `HP: ${card.hp}` : '',
                card.types ? `Type: ${card.types.join('/')}` : '',
                `(owned: ${owned})`
              ].filter(Boolean).join(' | ');
            }).join('\n');
            
            const { uploadFileToDiscord, deleteMessage, getChannelMessages } = require('./discord');
            const STORAGE_CHANNEL_ID = '1476540488147533895';
            const fileName = `cards_${cardQuery}_${Date.now()}.txt`;
            
            // Delete old query files from this user
            try {
              const messages = await getChannelMessages(STORAGE_CHANNEL_ID, 50);
              for (const msg of messages) {
                if (msg.content?.includes(`${actualUsername} requested cards`) && msg.attachments?.length > 0) {
                  await deleteMessage(STORAGE_CHANNEL_ID, msg.id).catch(() => {});
                }
              }
            } catch {}
            
            const result = await uploadFileToDiscord(
              STORAGE_CHANNEL_ID,
              fileContent,
              fileName,
              `${actualUsername} requested cards: ${cardQuery}`
            );
            
            if (result && result.data && (result.data as any).attachments?.[0]?.url) {
              const discordUrl = (result.data as any).attachments[0].url;
              await sendChatMessage(`@${actualUsername}: Found ${matches.length} cards with "${cardQuery}"! Download: ${discordUrl}`, 'broadcaster').catch(() => {});
            }
            
            // Show cards on overlay in batches of 20
            if (typeof (global as any).broadcast === 'function') {
              const BATCH_SIZE = 20;
                            const batches: Array<any[]> = [];
              
              for (let i = 0; i < matches.length; i += BATCH_SIZE) {
                batches.push(matches.slice(i, i + BATCH_SIZE));
              }
              
              for (let i = 0; i < batches.length; i++) {
                setTimeout(() => {
                  (global as any).broadcast({
                    type: 'pokemon-show-cards-grid',
                    payload: {
                      cards: batches[i].map((card: any) => {
                        const owned = userCards.filter((c: any) => c.number === card.number && c.setCode === card.setCode).length;
                        return {
                          imageUrl: card.images?.large,
                          name: card.name,
                          number: card.number,
                          setCode: card.setCode,
                          rarity: card.rarity,
                          hp: card.hp,
                          types: card.types,
                          level: card.level,
                          owned
                        };
                      }),
                      username: actualUsername,
                      batch: i + 1,
                      totalBatches: batches.length
                    }
                  });
                }, i * 5000); // 5 second delay between batches
              }
            }
          } else {
            // Show in chat if 5 or fewer
            for (const card of matches) {
              const owned = userCards.filter((c: any) => c.number === card.number && c.setCode === card.setCode).length;
              
              const info = [
                `${card.name}`,
                card.level ? `Lv.${card.level}` : '',
                `#${card.number}`,
                `${card.rarity || 'Common'}`,
                card.hp ? `HP: ${card.hp}` : '',
                card.types ? `Type: ${card.types.join('/')}` : '',
                `(owned: ${owned})`
              ].filter(Boolean).join(' | ');
              
              await sendChatMessage(`@${actualUsername}: ${info}`, 'broadcaster').catch(() => {});
              
              if (typeof (global as any).broadcast === 'function') {
                (global as any).broadcast({
                  type: 'pokemon-show-card',
                  payload: {
                    imageUrl: card.images?.large,
                    name: card.name,
                    number: card.number,
                    setCode: card.setCode,
                    rarity: card.rarity,
                    hp: card.hp,
                    types: card.types,
                    level: card.level,
                    attacks: card.attacks,
                    abilities: card.abilities,
                    username: actualUsername,
                    owned
                  }
                });
              }
            }
          }
          return;
        }
        // Handle !t one-off translation for mods
        if (actualMessage.toLowerCase().startsWith('!t ')) {
            const args = actualMessage.substring(3).trim().split(/\s+/);
            const translated = await handleOneOffTranslation(args);
            if (translated) {
                await sendChatMessage(translated, 'bot').catch(() => {});
                return;
            }
        }
        
        // Handle !addpoints command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!addpoints ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const args = actualMessage.substring(11).trim().split(/\s+/);
                const targetUser = args[0]?.replace('@', '');
                const amount = parseInt(args[1]);
                if (!targetUser || isNaN(amount)) {
                    await sendChatMessage(`@${actualUsername}, usage: !addPoints @user amount`, 'bot').catch(() => {});
                } else {
                    const result = await addPoints(targetUser, amount, `addpoints by ${actualUsername}`);
                    await sendChatMessage(`@${targetUser} now has ${result.points} pts (${amount > 0 ? '+' : ''}${amount})`, 'broadcaster').catch(() => {});
                }
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can use that!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !setpoints command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!setpoints ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const args = actualMessage.substring(11).trim().split(/\s+/);
                const targetUser = args[0]?.replace('@', '');
                const amount = parseInt(args[1]);
                if (!targetUser || isNaN(amount)) {
                    await sendChatMessage(`@${actualUsername}, usage: !setPoints @user amount`, 'bot').catch(() => {});
                } else {
                    const result = await setPoints(targetUser, amount);
                    await sendChatMessage(`@${targetUser} set to ${result.points} pts`, 'broadcaster').catch(() => {});
                }
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can use that!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !addtoall command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!addtoall ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const amount = parseInt(actualMessage.substring(10).trim());
                if (isNaN(amount)) {
                    await sendChatMessage(`@${actualUsername}, usage: !addToAll amount`, 'bot').catch(() => {});
                } else {
                    const { addPointsToAll } = require('./points');
                    const count = await addPointsToAll(amount);
                    await sendChatMessage(`${amount > 0 ? '+' : ''}${amount} pts to ${count} users!`, 'broadcaster').catch(() => {});
                }
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can use that!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !settoall command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!settoall ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const amount = parseInt(actualMessage.substring(10).trim());
                if (isNaN(amount)) {
                    await sendChatMessage(`@${actualUsername}, usage: !setToAll amount`, 'bot').catch(() => {});
                } else {
                    const { setPointsToAll } = require('./points');
                    const count = await setPointsToAll(amount);
                    await sendChatMessage(`Set ${count} users to ${amount} pts`, 'broadcaster').catch(() => {});
                }
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can use that!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !resetallpoints command (mod/broadcaster only)
        if (actualMessage.toLowerCase() === '!resetallpoints') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { resetAllPoints } = require('./points');
                const count = await resetAllPoints();
                await sendChatMessage(`Reset points for ${count} users to 0`, 'broadcaster').catch(() => {});
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can use that!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !givepoints command
        if (actualMessage.toLowerCase().startsWith('!givepoints ')) {
            const args = actualMessage.substring(12).trim().split(/\s+/);
            const targetUser = args[0]?.replace('@', '');
            const amount = parseInt(args[1]);
            
            if (!targetUser || isNaN(amount)) {
                await sendChatMessage(`@${actualUsername}, usage: !givepoints @user amount`, 'bot').catch(() => {});
                return;
            }
            
            const result = await givePoints(actualUsername, targetUser, amount);
            await sendChatMessage(result.message, 'bot').catch(() => {});
            return;
        }
        
        // Handle !stealpoints command
        if (actualMessage.toLowerCase().startsWith('!stealpoints ')) {
            const args = actualMessage.substring(13).trim().split(/\s+/);
            const targetUser = args[0]?.replace('@', '');
            const amount = parseInt(args[1]);
            
            if (!targetUser || isNaN(amount)) {
                await sendChatMessage(`@${actualUsername}, usage: !stealpoints @user amount`, 'bot').catch(() => {});
                return;
            }
            
            const result = await stealPoints(actualUsername, targetUser, amount);
            await sendChatMessage(result.message, 'bot').catch(() => {});
            return;
        }
        
        // Handle !greetingmode command
        if (actualMessage.toLowerCase() === '!greetingmode') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { toggleGreetingMode, getGreetingMode } = require('./welcome-wagon');
                await toggleGreetingMode();
                const mode = await getGreetingMode();
                await sendChatMessage(`🤖 AI greeting mode: ${mode.toUpperCase()}`, 'bot').catch(() => {});
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can change greeting mode!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !welcomemode command
        if (actualMessage.toLowerCase() === '!welcomemode') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { toggleWelcomeMode, getWelcomeMode } = require('./welcome-wagon');
                await toggleWelcomeMode();
                const mode = await getWelcomeMode();
                await sendChatMessage(`🎉 Welcome mode: ${mode === 'overlay' ? 'OVERLAY ONLY' : 'CHAT + OVERLAY'}`, 'bot').catch(() => {});
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can change welcome mode!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !gamble command (Classic Chat Gamble)
        if (actualMessage.toLowerCase().startsWith('!gamble ')) {
            const betInput = actualMessage.substring(8).trim();
            const userPointsData = await getPoints(actualUsername);
            const result = await handleClassicGamble(actualUsername, betInput, userPointsData.points);
            if (result) {
                await setPoints(actualUsername, result.newTotal);
            }
            return;
        }
        
        // Handle !gamble with no args (use default)
        if (actualMessage.toLowerCase() === '!gamble') {
            const userPointsData = await getPoints(actualUsername);
            const result = await handleClassicGamble(actualUsername, '', userPointsData.points);
            if (result) {
                await setPoints(actualUsername, result.newTotal);
            }
            return;
        }
        
        // Handle !gamblemode command - toggle between modes
        if (actualMessage.toLowerCase() === '!gamblemode') {
            const { toggleGambleMode, getGambleMode } = require('./gamble/classic-gamble');
            await toggleGambleMode(actualUsername);
            const mode = await getGambleMode();
            await sendChatMessage(`🎲 Gamble mode: ${mode.toUpperCase()}`, 'bot').catch(() => {});
            return;
        }
        
        // Handle !roll command
        if (actualMessage.toLowerCase().startsWith('!roll ')) {
            const betInput = actualMessage.substring(6).trim();
            const userPointsData = await getPoints(actualUsername);
            const result = await handleRoll(actualUsername, betInput, userPointsData.points);
            if (result) {
                await setPoints(actualUsername, result.newTotal);
                // Store double-or-nothing state (30 second window)
                const doubleState = { username: actualUsername, wager: Math.abs(result.change) || parseInt(betInput), expires: Date.now() + 30000 };
                (global as any).doubleOrNothingState = doubleState;
            }
            return;
        }
        
        // Handle !double command (double or nothing)
        if (actualMessage.toLowerCase() === '!double') {
            const doubleState = (global as any).doubleOrNothingState;
            if (!doubleState || doubleState.username !== actualUsername || Date.now() > doubleState.expires) {
                await sendChatMessage(`@${actualUsername}, no active double-or-nothing available!`, 'bot').catch(() => {});
                return;
            }
            
            const userPointsData = await getPoints(actualUsername);
            const result = await handleDouble(actualUsername, doubleState.wager, userPointsData.points);
            if (result) {
                await setPoints(actualUsername, result.newTotal);
            }
            
            // Clear the double state
            delete (global as any).doubleOrNothingState;
            return;
        }
        
        // Handle !brb command
        if (actualMessage.toLowerCase().includes('be right back') || actualMessage.toLowerCase() === '!brb') {
            if (tags.mod || tags.badges?.broadcaster) {
                const broadcasterName = broadcasterUsername;
                startBRB(broadcasterName).catch(err => console.error('[BRB] Error:', err));
                await sendChatMessage('🎬 Starting BRB clip player...', 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !back command
        if (actualMessage.toLowerCase() === '!back') {
            if (tags.mod || tags.badges?.broadcaster) {
                stopBRB();
                await sendChatMessage('👋 Welcome back!', 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !clipmode command
        if (actualMessage.toLowerCase() === '!clipmode') {
            if (tags.mod || tags.badges?.broadcaster) {
                await toggleClipMode();
                const mode = await getClipMode();
                await sendChatMessage(`🎬 Clip mode: ${mode === 'viewer' ? 'VIEWER CLIPS' : 'MY CLIPS'}`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !chatmode command - toggle single/shared chat processing
        if (actualMessage.toLowerCase() === '!chatmode') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { toggleChatMode } = require('./shared-chat');
                const newMode = await toggleChatMode();
                await sendChatMessage(
                    newMode === 'shared'
                        ? '🔗 Chat mode switched to SHARED — bot will respond to mirrored shared-chat messages.'
                        : '🔒 Chat mode switched to SINGLE — bot will only respond to messages from this channel.',
                    'bot'
                ).catch(() => {});
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can change chat mode!`, 'bot').catch(() => {});
            }
            return;
        }
        if (actualMessage.toLowerCase().startsWith('!so ')) {
            const targetName = actualMessage.substring(4).trim().replace('@', '');
            if (targetName) {
                console.log(`[Dispatcher] Processing !so shoutout for ${targetName}`);
                const profileImage = `https://static-cdn.jtvnw.net/jtv_user_pictures/${targetName}-profile_image-300x300.png`;
                await handleWalkOnShoutout(targetName, targetName, profileImage, true).catch(err => {
                    console.error('[Dispatcher] !so shoutout failed:', err);
                    sendChatMessage(`@${actualUsername}, shoutout failed: ${err.message}`, 'bot').catch(() => {});
                });
            }
            return;
        }
        
        // Handle !checkin / !partner command — same flow as channel point redeem
        if (actualMessage.toLowerCase().startsWith('!checkin') || actualMessage.toLowerCase().startsWith('!partner')) {
            const cmd = actualMessage.split(' ')[0];
            const numArg = actualMessage.substring(cmd.length).trim();
            const { getConfigSection } = require('../lib/local-config/service');
            const redeemsConfig = await getConfigSection('redeems');
            const guildId = redeemsConfig.partnerCheckin.discordGuildId;
            const roleName = redeemsConfig.partnerCheckin.discordRoleName;
            const pointCost = redeemsConfig.partnerCheckin.pointCost;

            if (!guildId || !roleName) {
                await sendChatMessage(`@${actualUsername}, partner check-ins are not configured yet!`, 'broadcaster').catch(() => {});
                return;
            }

            if (pointCost > 0) {
                const { getUserPoints } = require('./points');
                const pts = await getUserPoints(actualUsername);
                if (pts < pointCost) {
                    await sendChatMessage(`@${actualUsername}, you need ${pointCost} points for a partner check-in! (You have ${pts})`, 'broadcaster').catch(() => {});
                    return;
                }
            }

            const { getAllPartners } = require('./partner-checkin');
            const partners = await getAllPartners(guildId, roleName);
            if (partners.length > 0) {
                const list = partners.map((p: any) => `${p.id}.${p.name}`).join(' ');
                sendChatMessage(`Partner Check-Ins: ${list}`, 'broadcaster').catch(() => {});
            }

            const partnerId = parseInt(numArg, 10);
            if (!partnerId || isNaN(partnerId) || partnerId < 1) {
                const { trackChatMessageForRedemption } = require('./eventsub');
                const pendingPartnerCheckins = require('./eventsub').pendingPartnerCheckins;
                if (pendingPartnerCheckins) {
                    pendingPartnerCheckins.set(actualUsername.toLowerCase(), { timestamp: Date.now(), guildId, roleName, pointCost });
                }
                return;
            }

            const { handlePartnerCheckinCmd } = require('./eventsub');
            await handlePartnerCheckinCmd(actualUsername, partnerId, guildId, roleName, pointCost);
            return;
        }
        
        // Handle !offer command (Pokemon trade)
        if (actualMessage.toLowerCase().startsWith('!offer ')) {
            const cardIdentifier = actualMessage.substring(7).trim();
            const { offerCard } = require('./pokemon-trade-manager');
            await offerCard(actualUsername, cardIdentifier);
            return;
        }
        
        // Handle !accept command (Pokemon trade)
        if (actualMessage.toLowerCase() === '!accept') {
            const { acceptTrade } = require('./pokemon-trade-manager');
            await acceptTrade(actualUsername);
            return;
        }
        
        // Handle !cancel command (Pokemon trade)
        if (actualMessage.toLowerCase() === '!cancel') {
            const { cancelTrade } = require('./pokemon-trade-manager');
            await cancelTrade(actualUsername);
            return;
        }
        
        // Handle !challenge command (Gym Battle queue)
        if (actualMessage.toLowerCase() === '!challenge') {
            const { joinQueue } = require('./gym-battle');
            await joinQueue(actualUsername);
            return;
        }
        
        // Handle !nextchallenger command (Streamer starts next battle)
        if (actualMessage.toLowerCase() === '!nextchallenger') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { startNextBattle } = require('./gym-battle');
                await startNextBattle();
            } else {
                await sendChatMessage(`@${actualUsername}, only the gym leader can start battles!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !attack command (Gym Battle)
        if (actualMessage.toLowerCase() === '!attack') {
            const { battleAttack } = require('./gym-battle');
            await battleAttack(actualUsername);
            return;
        }
        
        // Handle !switch command (Gym Battle)
        if (actualMessage.toLowerCase() === '!switch') {
            const { battleSwitch } = require('./gym-battle');
            await battleSwitch(actualUsername);
            return;
        }
        
        // Handle !clip command
        if (actualMessage.toLowerCase() === '!clip') {
            try {
                const response = await fetch('http://127.0.0.1:3100/api/twitch/create-clip', { method: 'POST' });
                if (response.ok) {
                    const data = await response.json();
                    await sendChatMessage(`📹 Clip created! ${data.url}`, 'broadcaster').catch(() => {});
                } else {
                    await sendChatMessage(`@${actualUsername}, failed to create clip!`, 'broadcaster').catch(() => {});
                }
            } catch (error) {
                console.error('[Dispatcher] Clip creation failed:', error);
            }
            return;
        }
        
        // Handle !coinflip command
        if (actualMessage.toLowerCase() === '!coinflip') {
            const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
            await sendChatMessage(`@${actualUsername} flipped a coin: ${result}! 🪙`, 'broadcaster').catch(() => {});
            return;
        }
        
        // Handle !followage command
        if (actualMessage.toLowerCase().startsWith('!followage')) {
            const args = actualMessage.substring(11).trim();
            const targetUser = args ? args.replace('@', '') : actualUsername;
            
            try {
                const { getTwitchUser } = require('./twitch');
                const user = await getTwitchUser(targetUser, 'login');
                
                if (user?.followedAt) {
                    const followDate = new Date(user.followedAt);
                    const now = new Date();
                    const diffMs = now.getTime() - followDate.getTime();
                    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    const years = Math.floor(days / 365);
                    const months = Math.floor((days % 365) / 30);
                    const remainingDays = days % 30;
                    
                    let timeStr = '';
                    if (years > 0) timeStr += `${years}y `;
                    if (months > 0) timeStr += `${months}m `;
                    timeStr += `${remainingDays}d`;
                    
                    await sendChatMessage(`@${targetUser} has been following for ${timeStr}!`, 'bot').catch(() => {});
                } else {
                    await sendChatMessage(`@${targetUser} is not following!`, 'bot').catch(() => {});
                }
            } catch (error) {
                await sendChatMessage(`@${actualUsername}, couldn't fetch follow data!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !followed command
        if (actualMessage.toLowerCase() === '!followed') {
            try {
                const { getTwitchUser } = require('./twitch');
                const user = await getTwitchUser(actualUsername, 'login');
                
                if (user?.followedAt) {
                    const followDate = new Date(user.followedAt);
                    await sendChatMessage(`@${actualUsername} followed on ${followDate.toLocaleDateString()}!`, 'broadcaster').catch(() => {});
                } else {
                    await sendChatMessage(`@${actualUsername}, you're not following!`, 'broadcaster').catch(() => {});
                }
            } catch (error) {
                await sendChatMessage(`@${actualUsername}, couldn't fetch follow data!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !followers command
        if (actualMessage.toLowerCase() === '!followers') {
            try {
                const response = await fetch('http://127.0.0.1:3100/api/twitch/user');
                if (response.ok) {
                    const data = await response.json();
                    await sendChatMessage(`Current followers: ${data.followerCount?.toLocaleString() || 'Unknown'}`, 'broadcaster').catch(() => {});
                }
            } catch (error) {
                console.error('[Dispatcher] Followers fetch failed:', error);
            }
            return;
        }
        
        // Handle !time command
        if (actualMessage.toLowerCase() === '!time') {
            const now = new Date();
            const pst = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
            const mst = now.toLocaleString('en-US', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit' });
            const cst = now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' });
            const est = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
            const utc = now.toLocaleString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
            
            await sendChatMessage(
                `🕐 PST: ${pst} | MST: ${mst} | CST: ${cst} | EST: ${est} | UTC: ${utc}`,
                'broadcaster'
            ).catch(() => {});
            return;
        }
        
        // Handle !uptime command
        if (actualMessage.toLowerCase() === '!uptime') {
            try {
                const response = await fetch('http://127.0.0.1:3100/api/twitch/live');
                if (response.ok) {
                    const data = await response.json();
                    if (data.isLive && data.startedAt) {
                        const start = new Date(data.startedAt);
                        const now = new Date();
                        const diffMs = now.getTime() - start.getTime();
                        const hours = Math.floor(diffMs / (1000 * 60 * 60));
                        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                        
                        await sendChatMessage(`Stream uptime: ${hours}h ${minutes}m`, 'broadcaster').catch(() => {});
                    } else {
                        await sendChatMessage('Stream is offline!', 'broadcaster').catch(() => {});
                    }
                }
            } catch (error) {
                console.error('[Dispatcher] Uptime fetch failed:', error);
            }
            return;
        }
        
        // Handle !watchtime command
        if (actualMessage.toLowerCase() === '!watchtime') {
            try {
                const { getUser } = require('./user-stats');
                const user = await getUser(actualUsername);
                const hours = Math.floor(user.watchtime / 60);
                const minutes = user.watchtime % 60;
                
                await sendChatMessage(
                    `@${actualUsername} has watched for ${hours}h ${minutes}m!`,
                    'bot'
                ).catch(() => {});
            } catch (error) {
                console.error('[Dispatcher] Watchtime fetch failed:', error);
            }
            return;
        }
        
        // Handle !stats command
        if (actualMessage.toLowerCase() === '!stats') {
            try {
                const response = await fetch('http://127.0.0.1:3100/api/twitch/user');
                if (response.ok) {
                    const data = await response.json();
                    await sendChatMessage(
                        `📊 Followers: ${data.followerCount?.toLocaleString() || 0} | Views: ${data.viewCount?.toLocaleString() || 0}`,
                        'bot'
                    ).catch(() => {});
                }
            } catch (error) {
                console.error('[Dispatcher] Stats fetch failed:', error);
            }
            return;
        }
        
        // Handle !setgame command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!setgame ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const game = actualMessage.substring(9).trim();
                try {
                    const response = await fetch('http://127.0.0.1:3100/api/twitch/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ game })
                    });
                    
                    if (response.ok) {
                        await sendChatMessage(`🎮 Game set to: ${game}`, 'bot').catch(() => {});
                    } else {
                        await sendChatMessage(`Failed to set game!`, 'bot').catch(() => {});
                    }
                } catch (error) {
                    console.error('[Dispatcher] Set game failed:', error);
                }
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can change the game!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !settitle command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!settitle ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const title = actualMessage.substring(10).trim();
                try {
                    const response = await fetch('http://127.0.0.1:3100/api/twitch/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title })
                    });
                    
                    if (response.ok) {
                        await sendChatMessage(`📝 Title set to: ${title}`, 'bot').catch(() => {});
                    } else {
                        await sendChatMessage(`Failed to set title!`, 'bot').catch(() => {});
                    }
                } catch (error) {
                    console.error('[Dispatcher] Set title failed:', error);
                }
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can change the title!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !raidmessage command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!raidmessage ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const message = actualMessage.substring(13).trim();
                // Store raid message
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const configPath = path.join(process.cwd(), 'tokens', 'raid-message.json');
                    fs.writeFileSync(configPath, JSON.stringify({ message }, null, 2));
                    await sendChatMessage(`✅ Raid message set!`, 'broadcaster').catch(() => {});
                } catch (error) {
                    console.error('[Dispatcher] Raid message save failed:', error);
                }
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can set the raid message!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !commands
        if (actualMessage.toLowerCase() === '!commands') {
            const cmdSummary = '🎮 Fun: !hug,!boop,!cuddle,!dance,!highfive,!lurk,!unlurk | 🎲 Games: !gamble,!roll,!double,!coinflip | 🃏 Pokemon: !pack,!collection,!show <card>,!trade,!offer,!accept,!challenge,!attack,!switch | 📊 Info: !points,!followage,!uptime,!time,!watchtime,!stats | 🏆 Leaders: !leader,!pleader,!wleader,!cleader,!bleader | 🔧 Type !admin for mod commands';
            await sendChatMessage(cmdSummary, 'broadcaster').catch(() => {});
            return;
        }
        
        // Handle leaderboard commands
        if (['!leader', '!pleader', '!wleader', '!cleader', '!bleader', '!bitsleader'].includes(actualMessage.split(' ')[0].toLowerCase())) {
            const cmd = actualMessage.split(' ')[0].toLowerCase();
            const args = actualMessage.substring(cmd.length).trim();
            const broadcastFn = typeof (global as any).broadcast === 'function' ? (global as any).broadcast : () => {};
            await handleLeaderboardCommand(cmd, actualUsername, args, broadcastFn);
            return;
        }
        
        // Handle !pack command — same flow as PokePack channel point redeem
        if (actualMessage.toLowerCase().startsWith('!pack')) {
            const numArg = actualMessage.substring(5).trim();
            const { getConfigSection } = require('../lib/local-config/service');
            const redeemsConfig = await getConfigSection('redeems');
            const pointCost = redeemsConfig.pokePack.pointCost;

            if (pointCost > 0) {
                const { getUserPoints } = require('./points');
                const pts = await getUserPoints(actualUsername);
                if (pts < pointCost) {
                    await sendChatMessage(`@${actualUsername}, you need ${pointCost} points to open a pack! (You have ${pts})`, 'broadcaster').catch(() => {});
                    return;
                }
            }

            const { getEnabledSetMap, formatSetList } = require('./pokemon-packs');
            const enabledSets = redeemsConfig.pokePack.enabledSets || ['base1','base2','base3','base4','base5','gym1'];
            const setMap = getEnabledSetMap(enabledSets);
            const setCount = Object.keys(setMap).length;
            sendChatMessage(formatSetList(setMap), 'broadcaster').catch(() => {});

            const setNumber = parseInt(numArg, 10);
            if (!setNumber || isNaN(setNumber) || setNumber < 1 || setNumber > setCount) {
                const { pendingPackRedeems } = require('./eventsub');
                if (pendingPackRedeems) {
                    pendingPackRedeems.set(actualUsername.toLowerCase(), { timestamp: Date.now(), pointCost });
                }
                return;
            }

            const { handlePackOpenCmd } = require('./eventsub');
            await handlePackOpenCmd(actualUsername, setNumber, pointCost);
            return;
        }
        
        // Handle !admin
        if (actualMessage.toLowerCase() === '!admin') {
            if (tags.mod || tags.badges?.broadcaster) {
                const adminSummary = '🔧 Admin: !so <user>, !setgame <game>, !settitle <title>, !raidmessage <msg>, !greetingmode, !welcomemode, !clipmode, !chatmode, !brb, !back';
                await sendChatMessage(adminSummary, 'broadcaster').catch(() => {});
            } else {
                await sendChatMessage(`@${actualUsername}, only mods can view admin commands!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // 1. Command Handling from JSON files
        const commands = await getAllCommands();
        const cmdName = actualMessage.substring(1).split(' ')[0].toLowerCase();
        console.log(`[Dispatcher] Looking for command: ${cmdName}`);
        console.log(`[Dispatcher] Available commands:`, commands.map((c: any) => c.command).join(', '));
        
        const command = commands.find(c => c.command.toLowerCase().replace(/^!/, '') === cmdName && c.enabled);
        
        if (command) {
            console.log(`[Dispatcher] Found command: ${command.name}`);
            console.log(`[Dispatcher] Command has actionId:`, (command as any).actionId);
            console.log(`[Dispatcher] cmdName: ${cmdName}`);
            
            // Handle simple response
            if ((command as any).response && !(command as any).actionId && !(command as any).actions) {
                await sendChatMessage((command as any).response, 'broadcaster').catch(() => {});
                return;
            }
            
            // Handle simple social commands (only if no actionId)
            if (!(command as any).actionId) {
                const socialCommands: Record<string, string> = {
                    'hug': '{user} wraps {target} in the cosmic warmth of love and understanding 🤗',
                    'boop': '{user} boops {target} on the nose! *boop* 👉',
                    'cuddle': '{user} cuddles up with {target} in a cozy embrace 🥰',
                    'dance': '{user} breaks out into a dance with {target}! 💃🕺',
                    'fistbump': '{user} gives {target} an epic fist bump! 👊',
                    'headpat': '{user} gently pats {target} on the head *pat pat* 🤚',
                    'highfive': '{user} high-fives {target}! ✋',
                    'love': '{user} sends love to {target}! ❤️',
                    'tickle': '{user} tickles {target}! *giggle* 😆',
                    'lurk': '{user} is lurking in the shadows 👀',
                    'unlurk': '{user} emerges from the shadows! Welcome back! 👋',
                    'hydrate': 'Time to hydrate! 💧 Stay healthy, chat!',
                    'stretch': 'Stretch break! 🤸 Take care of your body!',
                    'yes': 'Yes! ✅',
                    'yup': 'Yup! 👍',
                    'no': 'Nope! ❌',
                    'hover': '{user} hovers mysteriously 🛸',
                };
                
                if (socialCommands[cmdName]) {
                    const args = actualMessage.substring(cmdName.length + 2).trim();
                    const target = args || 'someone';
                    const response = socialCommands[cmdName]
                        .replace('{user}', actualUsername)
                        .replace('{target}', target);
                    await sendChatMessage(response, 'bot').catch(() => {});
                    return;
                }
            }
            

            
            // Execute action if linked
            if ((command as any).actionId) {
                console.log(`[Dispatcher] Command has actionId: ${(command as any).actionId}`);
                const action = await getActionById((command as any).actionId);
                console.log(`[Dispatcher] Action found:`, action ? 'YES' : 'NO');
                console.log(`[Dispatcher] Action object:`, JSON.stringify(action));
                if (action && (action as any).handler) {
                    const handler = (action as any).handler;
                    console.log(`[Dispatcher] Executing handler: ${handler}`);
                    
                    // Execute custom handlers
                    if (handler === 'pokemon-pack-open') {
                        const PACK_COST = 1000;
                        const userPoints = await getPoints(actualUsername);
                        
                        if (userPoints.points < PACK_COST) {
                            await sendChatMessage(`@${actualUsername}, you need ${PACK_COST} points to open a pack! (You have ${userPoints.points})`, 'broadcaster').catch(() => {});
                            return;
                        }
                        
                        await setPoints(actualUsername, userPoints.points - PACK_COST);
                        
                        const { openPack } = require('./pokemon-packs');
                        const result = await openPack(1, actualUsername);
                        if (result) {
                            const cardInfo = result.pack.map((c: any) => {
                              const isHolo = c.rarity && c.rarity.includes('Holo');
                              const isRare = c.rarity && c.rarity.includes('Rare');
                              const marker = isRare ? ' ✨' : (isHolo ? ' ⭐' : '');
                              return `${c.name} #${c.number}${marker}`;
                            }).join(', ');
                            
                            const { getUserCards } = require('./pokemon-collection');
                            const allCards = await getUserCards(actualUsername);
                            const rareCount = allCards.filter((c: any) => c.rarity && c.rarity.includes('Rare')).length;
                            
                            await sendChatMessage(`@${actualUsername} opened a ${result.setName} pack and got: ${cardInfo} | Total: ${allCards.length} cards (${rareCount} rare)`, 'broadcaster').catch(() => {});
                        }
                    }
                } else if (action && action.subActions && action.subActions.length > 0) {
                    // Execute subActions using SubActionExecutor
                    const { SubActionExecutor } = await import('./automation/SubActionExecutor');
                    const executor = new SubActionExecutor();
                    await executor.executeAction(action, { userName: actualUsername, args: {}, variables: {} });
                }
            }
            
            if ((command as any).actions && (command as any).actions.length > 0) {
                const actionType = (command as any).actions[0].type;
                console.log(`[Dispatcher] Executing action type: ${actionType}`);
                
                if (actionType === 'commands-list-show') {
                    const response = 'Commands: !pack, !collection, !show <card>, !trade <user>, !offer <card>, !accept, !cancel, !challenge, !attack, !switch, !points, !gamble, !roll, !so <user>, !leader, !discord';
                    await sendChatMessage(response, 'broadcaster').catch(() => {});
                } else if (actionType === 'pokemon-pack-open') {
                    const PACK_COST = 1000;
                    const userPoints = await getPoints(actualUsername);
                    
                    if (userPoints.points < PACK_COST) {
                        await sendChatMessage(`@${actualUsername}, you need ${PACK_COST} points to open a pack! (You have ${userPoints.points})`, 'broadcaster').catch(() => {});
                        return;
                    }
                    
                    await setPoints(actualUsername, userPoints.points - PACK_COST);
                    
                    const { openPack } = require('./pokemon-packs');
                    const result = await openPack(1, actualUsername);
                    if (result) {
                        const cardInfo = result.pack.map((c: any) => {
                          const isHolo = c.rarity && c.rarity.includes('Holo');
                          const isRare = c.rarity && c.rarity.includes('Rare');
                          const marker = isRare ? ' ✨' : (isHolo ? ' ⭐' : '');
                          return `${c.name} #${c.number}${marker}`;
                        }).join(', ');
                        
                        const { getUserCards } = require('./pokemon-collection');
                        const allCards = await getUserCards(actualUsername);
                        const rareCount = allCards.filter((c: any) => c.rarity && c.rarity.includes('Rare')).length;
                        
                        await sendChatMessage(`@${actualUsername} opened a ${result.setName} pack and got: ${cardInfo} | Total: ${allCards.length} cards (${rareCount} rare)`, 'broadcaster').catch(() => {});
                    }
                } else if (actionType === 'pokemon-collection-show') {
                    const { getUserCards } = require('./pokemon-collection');
                    const cards = await getUserCards(actualUsername);
                    const rareCount = cards.filter((c: any) => c.rarity && c.rarity.includes('Rare')).length;
                    
                    // Create file and upload to Discord
                    const fileContent = cards.map((card: any) => {
                      return [
                        card.name,
                        `#${card.number}`,
                        `Set: ${card.setCode}`,
                        card.rarity || 'Common'
                      ].filter(Boolean).join(' | ');
                    }).join('\n');
                    
                    const { uploadFileToDiscord, deleteMessage, getChannelMessages } = require('./discord');
                    const STORAGE_CHANNEL_ID = '1476540488147533895';
                    const fileName = `collection_${actualUsername}_${Date.now()}.txt`;
                    
                    // Delete old collection files from this user
                    try {
                      const messages = await getChannelMessages(STORAGE_CHANNEL_ID, 50);
                      for (const msg of messages) {
                        if (msg.content?.includes(`${actualUsername}'s collection`) && msg.attachments?.length > 0) {
                          await deleteMessage(STORAGE_CHANNEL_ID, msg.id).catch(() => {});
                        }
                      }
                    } catch {}
                    
                    const result = await uploadFileToDiscord(
                      STORAGE_CHANNEL_ID,
                      fileContent,
                      fileName,
                      `${actualUsername}'s collection`
                    );
                    
                    let downloadUrl = '';
                    if (result && result.data && (result.data as any).attachments?.[0]?.url) {
                      downloadUrl = (result.data as any).attachments[0].url;
                    }
                    
                    await sendChatMessage(`@${actualUsername} has ${cards.length} cards (${rareCount} rare). Download: ${downloadUrl}`, 'broadcaster').catch(() => {});
                    
                    // Show on overlay in batches
                    if (typeof (global as any).broadcast === 'function') {
                      const BATCH_SIZE = 20;
                                            const batches: Array<any[]> = [];
                      
                      for (let i = 0; i < cards.length; i += BATCH_SIZE) {
                        batches.push(cards.slice(i, i + BATCH_SIZE));
                      }
                      
                      for (let i = 0; i < batches.length; i++) {
                        setTimeout(() => {
                          (global as any).broadcast({
                            type: 'pokemon-collection-show',
                            payload: { 
                              username: actualUsername, 
                              cards: batches[i],
                              batch: i + 1,
                              totalBatches: batches.length
                            }
                          });
                        }, i * 5000);
                      }
                    }
                } else if (actionType === 'pokemon-trade-initiate') {
                    const args = actualMessage.substring(cmdName.length + 2).trim().split(/\s+/);
                    const targetUser = args[0]?.replace('@', '');
                    
                    if (!targetUser) {
                        await sendChatMessage(`@${actualUsername}, usage: !trade @user`, 'bot').catch(() => {});
                        return;
                    }
                    
                    const { initiateTrade } = require('./pokemon-trade-manager');
                    await initiateTrade(actualUsername, targetUser);
                }
            }
            return;
        }
    } else {
        // Points & Welcome Wagon (only for non-self messages to avoid awarding yourself points)
        if (!self && !isBot && !consumedByRedemption) {
            awardChatPoints(actualUsername).catch(() => {});
            
            // Skip welcome wagon for broadcaster, bot, and messages from voice commands
            const skipWelcome = consumedByRedemption || tags.badges?.broadcaster || 
                                actualUsername.toLowerCase() === botUsername.toLowerCase() ||
                                message.includes('🌟');
            
            if (!skipWelcome && await shouldWelcomeUser(actualUsername)) {
                const welcomeMode = await getWelcomeMode();
                
                if (welcomeMode === 'overlay') {
                    // Overlay-only mode: broadcast to overlay without chat message
                    const profileImage = `https://static-cdn.jtvnw.net/jtv_user_pictures/${actualUsername}-profile_image-300x300.png`;
                    if (typeof (global as any).broadcast === 'function') {
                        (global as any).broadcast({
                            type: 'welcome-overlay',
                            payload: { username: actualUsername, displayName, profileImage }
                        });
                    }
                } else {
                    // Chat mode: trigger walk-on shoutout as before
                    const profileImage = `https://static-cdn.jtvnw.net/jtv_user_pictures/${actualUsername}-profile_image-300x300.png`;
                    handleWalkOnShoutout(actualUsername, displayName, profileImage).catch(err => {
                        console.error('[Dispatcher] Walk-on shoutout failed:', err);
                    });
                }
                
                markUserWelcomed(actualUsername).catch(() => {});
            }
        }
        
        // Check if message mentions bot (allow from anyone except bot itself and skip self messages)
        if (!isBot && !self) {
            const lowerMessage = actualMessage.toLowerCase();
            
            // Check for shoutout command (without bot name)
            // Skip messages that look like the formatted shoutout output to prevent re-triggering
            const isShoutoutOutput = lowerMessage.includes('go check out') && lowerMessage.includes('twitch.tv/');
            if (!isShoutoutOutput && (lowerMessage.includes('shout out') || lowerMessage.includes('shoutout'))) {
                console.log('[Dispatcher] Shoutout command detected');
                try {
                    const chattersResponse = await fetch('http://127.0.0.1:3100/api/chat/chatters');
                    let chatters = [];
                    if (chattersResponse.ok) {
                        const chattersData = await chattersResponse.json();
                        chatters = chattersData.chatters?.map((c: any) => c.user_display_name || c.user_login) || [];
                        console.log('[Dispatcher] Fetched chatters:', chatters.join(', '));
                    }
                    
                    const aiPrompt = `Voice command: "${actualMessage}"
Active chatters: ${chatters.join(', ')}

Find the best matching username from the chatters list and respond with ONLY the shoutout command in this format: !so @username

If no good match, respond with: Could not find matching user`;
                    
                    console.log('[Dispatcher] Calling AI generate for shoutout matching...');
                    const aiResponse = await fetch('http://127.0.0.1:3100/api/ai/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            prompt: aiPrompt,
                            temperature: 0.1,
                            maxOutputTokens: 50,
                        })
                    });
                    
                    console.log('[Dispatcher] AI generate response status:', aiResponse.status);
                    
                    if (aiResponse.ok) {
                        const aiData = await aiResponse.json();
                        const reply = aiData?.text?.trim();
                        console.log('[Dispatcher] AI generate reply:', reply);
                        
                        if (reply && reply.startsWith('!so @')) {
                            const targetName = reply.substring(5).trim();
                            console.log(`[Dispatcher] AI matched shoutout target: ${targetName}`);
                            const profileImage = `https://static-cdn.jtvnw.net/jtv_user_pictures/${targetName}-profile_image-300x300.png`;
                            await handleWalkOnShoutout(targetName, targetName, profileImage, true).catch(err => {
                                console.error('[Dispatcher] AI shoutout failed:', err);
                            });
                        } else {
                            console.log('[Dispatcher] AI did not return valid shoutout command');
                            await sendChatMessage('Could not find matching user in chat', 'bot').catch(() => {});
                        }
                    }
                } catch (error) {
                    console.error('[Dispatcher] AI shoutout matching failed:', error);
                }
                return;
            }
            
            const configuredBotName = (() => {
                try {
                    return getAIConfig().botName || '';
                } catch {
                    return '';
                }
            })();
            const botName = ((global as any).botName || configuredBotName || 'AI Bot').trim();
            const mentionTriggers = [
                `@${botUsername.toLowerCase()}`,
                botUsername.toLowerCase(),
                botName.toLowerCase(),
                `hey ${botName.toLowerCase()}`
            ].filter(Boolean);
            let mentionsBot = mentionTriggers.some(trigger => lowerMessage.includes(trigger));
            
            // Remove hardcoded Athena check - only use dynamic bot name
            if (mentionsBot) {
                console.log(`[Dispatcher] ${botName} mentioned by ${actualUsername}: ${actualMessage}`);
            } else {
                // Check if message contains bot interests (50% chance to respond)
                const botInterests = (global as any).botInterests || '';
                if (botInterests && Math.random() < 0.5) {
                    const interests = botInterests.toLowerCase().split(',').map((i: string) => i.trim());
                    const hasInterest = interests.some((interest: string) => lowerMessage.includes(interest));
                    
                    if (hasInterest) {
                        console.log(`[Dispatcher] Interest detected in message from ${actualUsername}: ${actualMessage}`);
                        mentionsBot = true;
                        // Mark this as an interest-based response for different prompt handling
                        (global as any).isInterestResponse = true;
                        (global as any).detectedInterest = interests.find((interest: string) => lowerMessage.includes(interest));
                    }
                }
            }
            
            if (mentionsBot) {
                
                // Use chat-with-memory API for context-aware responses
                try {
                    console.log('[Dispatcher] Calling chat-with-memory API...');
                    
                    // Check if this is an interest-based response
                    const isInterestResponse = (global as any).isInterestResponse;
                    const detectedInterest = (global as any).detectedInterest;
                    
                    let messageToSend = actualMessage;
                    if (isInterestResponse) {
                        messageToSend = `[INTEREST: ${detectedInterest}] Someone mentioned "${detectedInterest}" in chat: "${actualMessage}". Chime in naturally about this topic you're interested in. Be brief and conversational.`;
                        // Clear the flags
                        delete (global as any).isInterestResponse;
                        delete (global as any).detectedInterest;
                    }
                    
                    const response = await fetch('http://127.0.0.1:3100/api/ai/chat-with-memory', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: actualUsername,
                            message: messageToSend
                        })
                    });
                    
                    console.log('[Dispatcher] Chat-with-memory response status:', response.status);
                    
                    if (response.ok) {
                        const data = await response.json();
                        const reply = data.response?.trim() || '';
                        console.log('[Dispatcher] Chat-with-memory reply:', reply);
                        
                        if (reply) {
                            // Send the chat message
                            await sendChatMessage(reply, 'bot').catch(() => {});
                            
                            // Generate TTS for AI response
                            try {
                                const { textToSpeech } = await import('../ai/flows/text-to-speech');
                                const ttsResult = await textToSpeech({ text: reply, voice: 'Algieba' });
                                
                                if (ttsResult.audioDataUri) {
                                    const useTTSPlayer = process.env.USE_TTS_PLAYER !== 'false';
                                    
                                    if (useTTSPlayer) {
                                        await fetch('http://127.0.0.1:3100/api/tts/current', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ audioUrl: ttsResult.audioDataUri })
                                        }).catch(err => console.error('[Dispatcher] Failed to send TTS to player:', err));
                                    }
                                    
                                    if (typeof (global as any).broadcast === 'function') {
                                        (global as any).broadcast({
                                            type: 'play-tts',
                                            payload: { audioDataUri: ttsResult.audioDataUri }
                                        });
                                    }
                                }
                            } catch (err) {
                                console.error('[Dispatcher] TTS generation failed for AI response:', err);
                            }
                        }
                    } else {
                        const errorText = await response.text();
                        console.error('[Dispatcher] Chat-with-memory API error:', response.status, errorText);
                    }
                } catch (err) {
                    console.error(`[Dispatcher] ${botName} chat failed:`, err);
                }
            }
        }
    }
}

export async function handleDiscordMessage(msg: any) {
    // Check if Discord bridge is enabled
    const logChannelId = await getDiscordLogChannelId();
    if (!logChannelId) {
        return; // Bridge is disabled
    }
    
    const isCommand = msg.content.startsWith('!');
    
    // Bridge ALL messages to Twitch (skip if message came from another platform to avoid loop)
    if (!msg.content.startsWith('[')) {
        // Process message content to resolve mentions
        let processedContent = msg.content;
        
        // Replace user mentions with actual usernames
        if (msg.mentions && msg.mentions.users) {
            for (const [userId, user] of msg.mentions.users) {
                processedContent = processedContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `@${user.username}`);
            }
        }
        
        // Replace custom emojis
        processedContent = processedContent.replace(/<:(\w+):(\d+)>/g, ':$1:');
        
        // Send all Discord messages as bot with Discord prefix
        const twitchMessage = `[Discord] ${msg.author.username}: ${processedContent}`;
        await sendChatMessage(twitchMessage, 'bot').catch(e => console.error('[Bridge] Failed:', e));
    }
}
