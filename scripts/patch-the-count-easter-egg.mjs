import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patchFile(relativePath, transform) {
  const filePath = path.join(repoRoot, relativePath);
  const diskSource = fs.readFileSync(filePath, 'utf8');
  const before = diskSource.replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after === before && diskSource === before) {
    console.log(`The Count Easter egg patch already applied: ${relativePath}`);
    return;
  }
  fs.writeFileSync(filePath, after, 'utf8');
  console.log(`The Count Easter egg patch applied: ${relativePath}`);
}

patchFile('src/services/discord-structured-replies.ts', (source) => {
  const importMarker = "import { readPrivateChatSettings } from '@/lib/private-chat-settings-store';";
  const countImports = "import { getConfiguredAppUrl } from '@/lib/runtime-origin';\nimport { THE_COUNT_AVATAR_PATH, THE_COUNT_OWNER_TITLE, isTheCountName } from '@/lib/the-count';";
  if (!source.includes(countImports)) {
    if (!source.includes(importMarker)) throw new Error('The Count patch: structured reply import marker missing');
    source = source.replace(importMarker, `${importMarker}\n${countImports}`);
  }

  const avatarMarker = "const SPACEMOUNTAIN_FALLBACK_LOGO = 'https://spacemountain.live/assets/space-logo-main.png';";
  const avatarHelper = `${avatarMarker}\n\nfunction theCountAvatarUrl(): string {\n  return \`${'${getConfiguredAppUrl()}'}${'${THE_COUNT_AVATAR_PATH}'}\`;\n}`;
  if (!source.includes('function theCountAvatarUrl(): string')) {
    if (!source.includes(avatarMarker)) throw new Error('The Count patch: avatar marker missing');
    source = source.replace(avatarMarker, avatarHelper);
  }

  const ownerMarker = '  const owner = await resolveTenantOwnerBranding(speaker.tenantId);';
  const ownerReplacement = "  const owner = isTheCountName(speaker.botName)\n    ? { name: THE_COUNT_OWNER_TITLE, logo: theCountAvatarUrl() }\n    : await resolveTenantOwnerBranding(speaker.tenantId);";
  if (!source.includes(ownerReplacement)) {
    if (!source.includes(ownerMarker)) throw new Error('The Count patch: owner marker missing');
    source = source.replace(ownerMarker, ownerReplacement);
  }

  const buildAvatarMarker = "  const botAvatar = firstUrl(\n    webhookIdentity.avatarUrl,\n    await getAvatarUrlForTenant(speaker.tenantId),\n    SPACEMOUNTAIN_FALLBACK_LOGO,\n  );";
  const buildAvatarReplacement = "  const botAvatar = firstUrl(\n    isTheCountName(speaker.botName) ? theCountAvatarUrl() : webhookIdentity.avatarUrl,\n    await getAvatarUrlForTenant(speaker.tenantId),\n    SPACEMOUNTAIN_FALLBACK_LOGO,\n  );";
  if (!source.includes(buildAvatarReplacement)) {
    if (!source.includes(buildAvatarMarker)) throw new Error('The Count patch: payload avatar marker missing');
    source = source.replace(buildAvatarMarker, buildAvatarReplacement);
  }

  const sendAvatarMarker = "  const avatarUrl = firstUrl(\n    webhookIdentity.avatarUrl,\n    await getAvatarUrlForTenant(speaker.tenantId),\n    SPACEMOUNTAIN_FALLBACK_LOGO,\n  );";
  const sendAvatarReplacement = "  const avatarUrl = firstUrl(\n    isTheCountName(speaker.botName) ? theCountAvatarUrl() : webhookIdentity.avatarUrl,\n    await getAvatarUrlForTenant(speaker.tenantId),\n    SPACEMOUNTAIN_FALLBACK_LOGO,\n  );";
  if (!source.includes(sendAvatarReplacement)) {
    if (!source.includes(sendAvatarMarker)) throw new Error('The Count patch: send avatar marker missing');
    source = source.replace(sendAvatarMarker, sendAvatarReplacement);
  }

  return source;
});

patchFile('src/app/api/discord/chat/route.ts', (source) => {
  const importMarker = "import { readWorldLore, type WorldLoreCharacter } from '@/lib/world-lore-store';";
  const countImports = "import { THE_COUNT_NAME, THE_COUNT_PERSONALITY, THE_COUNT_STABLE_ID, isTheCountName, messageInvokesTheCount } from '@/lib/the-count';\nimport { getSpmtEasterEggEntitlement } from '@/lib/spmt-easter-eggs';";
  if (!source.includes(countImports)) {
    if (!source.includes(importMarker)) throw new Error('The Count patch: Discord route import marker missing');
    source = source.replace(importMarker, `${importMarker}\n${countImports}`);
  }

  const loreFilterMarker = "  const tenantCharacters = characters.filter((character) => character.stableId.startsWith(`${tenantId}:`) || character.stableId.startsWith('unknown:'));";
  const loreFilterReplacement = "  const tenantCharacters = characters.filter((character) =>\n    (character.stableId.startsWith(`${tenantId}:`) || character.stableId.startsWith('unknown:'))\n    && character.stableId !== THE_COUNT_STABLE_ID\n  );";
  if (!source.includes(loreFilterReplacement)) {
    if (!source.includes(loreFilterMarker)) throw new Error('The Count patch: lore candidate marker missing');
    source = source.replace(loreFilterMarker, loreFilterReplacement);
  }

  const botMatchMarker = '    let botMatch = await resolveMentionedBot(msgLower, tenantId);';
  const botMatchReplacement = `    let botMatch = await resolveMentionedBot(msgLower, tenantId);\n    // The Count is visible in ordinary rotating system replies, but personal\n    // invocation is the Black Hole egg entitlement. Keep this as the only gate.\n    if (messageInvokesTheCount(message)) {\n      const countMention = /(^|[^a-z0-9_])@?(?:the\\s+)?count([^a-z0-9_]|$)/i.exec(message);\n      const entitlement = await getSpmtEasterEggEntitlement({ provider: 'discord', providerUserId: userId });\n      if (entitlement.eggs.blackHole && countMention && (!botMatch || countMention.index <= botMatch.index)) {\n        botMatch = {\n          tenantId,\n          botName: THE_COUNT_NAME,\n          trigger: countMention[0].trim(),\n          index: countMention.index,\n        };\n      }\n    }`;
  if (!source.includes('The Count is visible in ordinary rotating system replies')) {
    if (!source.includes(botMatchMarker)) throw new Error('The Count patch: bot match marker missing');
    source = source.replace(botMatchMarker, botMatchReplacement);
  }

  const aiBodyMarker = "        message: botInteractionDecision?.shouldRespond ? botInteractionDecision.promptInstruction : message,\n        tenantId: botTenantId || tenantId || undefined,\n        context: 'discord',";
  const aiBodyReplacement = "        message: botInteractionDecision?.shouldRespond ? botInteractionDecision.promptInstruction : message,\n        personality: isTheCountName(botName) ? THE_COUNT_PERSONALITY : undefined,\n        responseName: isTheCountName(botName) ? THE_COUNT_NAME : undefined,\n        tenantId: botTenantId || tenantId || undefined,\n        context: isTheCountName(botName) ? 'discord-cross-bot' : 'discord',";
  if (!source.includes(aiBodyReplacement)) {
    if (!source.includes(aiBodyMarker)) throw new Error('The Count patch: AI request marker missing');
    source = source.replace(aiBodyMarker, aiBodyReplacement);
  }

  return source;
});

patchFile('src/services/chat-dispatcher.ts', (source) => {
  const importMarker = "import { getSpmtEasterEggEntitlement } from '../lib/spmt-easter-eggs';";
  const countImports = "import {\n    THE_COUNT_NAME,\n    THE_COUNT_PERSONALITY,\n    isTheCountTwitchLogin,\n    messageInvokesTheCount,\n} from '../lib/the-count';";
  if (!source.includes(countImports)) {
    if (!source.includes(importMarker)) throw new Error('The Count patch: Twitch dispatcher import marker missing');
    source = source.replace(importMarker, `${importMarker}\n${countImports}`);
  }

  const botMarker = "    const isBot = actualUsername.toLowerCase() === (botUsername || '').toLowerCase();\n    const isBotMessage = actualUsername.toLowerCase() === (botUsername || '').toLowerCase();\n";
  const botReplacement = "    const isTheCountAccountMessage = isTheCountTwitchLogin(actualUsername);\n    const isBot = actualUsername.toLowerCase() === (botUsername || '').toLowerCase() || isTheCountAccountMessage;\n    const isBotMessage = actualUsername.toLowerCase() === (botUsername || '').toLowerCase() || isTheCountAccountMessage;\n";
  if (!source.includes('const isTheCountAccountMessage = isTheCountTwitchLogin(actualUsername)')) {
    if (!source.includes(botMarker)) throw new Error('The Count patch: Twitch bot classification marker missing');
    source = source.replace(botMarker, botReplacement);
  }

  const selfMarker = "    // Skip self messages (broadcaster client echoes its own sends)\n    if (self) return;\n\n";
  const selfReplacement = "    // Skip self messages (broadcaster client echoes its own sends).\n    // The dedicated Count client is send-only, so its echo arrives through the\n    // tenant listener as another bot message and must be stopped explicitly.\n    if (self || isTheCountAccountMessage) return;\n\n";
  if (!source.includes('if (self || isTheCountAccountMessage) return;')) {
    if (!source.includes(selfMarker)) throw new Error('The Count patch: Twitch self-message marker missing');
    source = source.replace(selfMarker, selfReplacement);
  }

  const branchMarker = "            // Check for shoutout command (without bot name)\n";
  const countBranch = "            // The Count is a built-in character, not a tenant bot. His Twitch\n            // account is only a delivery identity; the canonical Black Hole\n            // entitlement remains the sole personal invocation gate.\n            if (!isCommand && !userIsKnownBot && messageInvokesTheCount(actualMessage)) {\n                const twitchUserId = String(tags?.['user-id'] || '').trim();\n                const entitlement = await getSpmtEasterEggEntitlement({\n                    provider: 'twitch',\n                    providerUserId: twitchUserId,\n                });\n                if (!entitlement.eggs.blackHole) {\n                    return;\n                }\n\n                try {\n                    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3100}/api/ai/chat-with-memory`, {\n                        method: 'POST',\n                        headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),\n                        body: JSON.stringify({\n                            username: actualUsername,\n                            displayName,\n                            userId: twitchUserId,\n                            message: actualMessage,\n                            personality: THE_COUNT_PERSONALITY,\n                            responseName: THE_COUNT_NAME,\n                            tenantId: tenantId || undefined,\n                            channelId: replyChannel,\n                            context: 'twitch-cross-bot',\n                        }),\n                    });\n\n                    if (!response.ok) {\n                        console.error('[Dispatcher] The Count Twitch AI failed:', response.status);\n                        return;\n                    }\n\n                    const data = await response.json();\n                    const aiReply = String(data.response || data.data?.response || '').trim();\n                    if (!aiReply) return;\n\n                    const responseChannel = await resolveTwitchReplyChannel({\n                        sourceChannel: replyChannel,\n                        sourceTenantId: tenantId,\n                        responseTenantId: tenantId,\n                    });\n                    await sendChatMessage(aiReply, 'count', responseChannel, tenantId);\n                    console.log(`[Dispatcher] The Count answered @${actualUsername} in #${responseChannel}`);\n                } catch (error) {\n                    console.error('[Dispatcher] The Count Twitch response failed:', error);\n                }\n                return;\n            }\n\n";
  if (!source.includes('The Count is a built-in character, not a tenant bot')) {
    if (!source.includes(branchMarker)) throw new Error('The Count patch: Twitch invocation marker missing');
    source = source.replace(branchMarker, `${countBranch}${branchMarker}`);
  }

  return source;
});

patchFile('src/app/api/ai/chat-with-memory/route.ts', (source) => {
  const commanderImport = "import { isCommander, getCommanderSystemPrompt, readCommanderMemory, appendCommanderMemory, formatCommanderHistory } from '@/lib/commander-memory';";
  const titleImport = "import { isVoidwalker, getVoidwalkerSystemPrompt } from '@/lib/voidwalker';";
  if (!source.includes(titleImport)) {
    if (!source.includes(commanderImport)) throw new Error('Voidwalker patch: commander import marker missing');
    source = source.replace(commanderImport, `${commanderImport}\n${titleImport}`);
  }

  const commanderMarker = '    const userIsCommander = isCommander(username);';
  const titleFlag = "    const userIsCommander = isCommander(username);\n    const userIsVoidwalker = userIsCommander ? false : await isVoidwalker({ context, providerUserId: userId });";
  if (!source.includes('const userIsVoidwalker = userIsCommander ? false : await isVoidwalker')) {
    if (!source.includes(commanderMarker)) throw new Error('Voidwalker patch: commander flag marker missing');
    source = source.replace(commanderMarker, titleFlag);
  }

  const commanderContextMarker = "    }\n\n    const contextFlags: Record<string, string> = {";
  const titleContextReplacement = "    }\n    const voidwalkerContext = userIsVoidwalker ? getVoidwalkerSystemPrompt() : '';\n\n    const contextFlags: Record<string, string> = {";
  if (!source.includes('const voidwalkerContext = userIsVoidwalker')) {
    if (!source.includes(commanderContextMarker)) throw new Error('Voidwalker patch: context marker missing');
    source = source.replace(commanderContextMarker, titleContextReplacement);
  }

  const promptMarker = '      commanderContext,\n      contextFlag,';
  const promptReplacement = '      commanderContext,\n      voidwalkerContext,\n      contextFlag,';
  if (!source.includes(promptReplacement)) {
    if (!source.includes(promptMarker)) throw new Error('Voidwalker patch: prompt marker missing');
    source = source.replace(promptMarker, promptReplacement);
  }

  return source;
});
