import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function patch(relativePath, transform) {
  const file = path.join(root, relativePath);
  const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after === before) {
    console.log(`[SignalPatch] already applied: ${relativePath}`);
    return;
  }
  fs.writeFileSync(file, after, 'utf8');
  console.log(`[SignalPatch] applied: ${relativePath}`);
}

patch('src/services/chat-dispatcher.ts', (source) => {
  const importMarker = "import { sendDiscordCommandShoutout } from './discord-command-shoutout';";
  const signalImport = "import { handleDiscordSignalCommand, handleTwitchSignalCommand } from './signal-system';";
  if (!source.includes(signalImport)) {
    if (!source.includes(importMarker)) throw new Error('Signal patch: command import marker missing');
    source = source.replace(importMarker, `${importMarker}\n${signalImport}`);
  }

  const nativeMarker = "    'commands', 'admin', 'so', 'watchtime', 'time', 'coinflip', 'leaderboard',";
  const nativeReplacement = "    'commands', 'admin', 'so', 'signal', 'watchtime', 'time', 'coinflip', 'leaderboard',";
  if (!source.includes(nativeReplacement)) {
    if (!source.includes(nativeMarker)) throw new Error('Signal patch: native command marker missing');
    source = source.replace(nativeMarker, nativeReplacement);
  }

  if (!source.includes("if (cmdName === 'signal')")) {
    const soMarker = "    if (cmdName === 'so') {";
    const signalBlock = `    if (cmdName === 'signal') {\n        try {\n            const result = await handleDiscordSignalCommand({\n                msg,\n                tenantId,\n                actualUsername,\n                actualMessage,\n                sourceChannelId,\n                sourceUserAvatarUrl,\n            });\n            if (!result.ok && result.message) {\n                await reply(\`@\${actualUsername}, \${result.message}\`);\n            }\n        } catch (error: any) {\n            console.error('[Discord Dispatcher] !signal failed:', error);\n            await reply(\`@\${actualUsername}, Signal failed: \${error?.message || 'unknown error'}\`);\n        }\n        return true;\n    }\n\n`;
    if (!source.includes(soMarker)) throw new Error('Signal patch: Discord !so marker missing');
    source = source.replace(soMarker, `${signalBlock}${soMarker}`);
  }

  if (!source.includes("handleTwitchSignalCommand({")) {
    const activityMarker = `    recordDashboardActivity({\n        id: String(tags.id || \`twitch-\${Date.now()}-\${Math.random().toString(36).slice(2)}\`),\n        tenantId,`;
    const twitchBlock = `    if (isCommand && /^!signal(?:\\s|$)/i.test(actualMessage)) {\n        try {\n            const result = await handleTwitchSignalCommand({\n                providerUserId: String(tags['user-id'] || tags.userId || ''),\n                username: actualUsername,\n                broadcaster: replyChannel,\n                tenantId,\n                rawMessage: actualMessage,\n            });\n            if (!result.ok && result.message) {\n                await replyMaybeKick(result.message, 'bot').catch(() => {});\n            }\n        } catch (error: any) {\n            console.error('[Dispatcher] Twitch !signal failed:', error);\n            await replyMaybeKick(\`@\${actualUsername}, Signal failed: \${error?.message || 'unknown error'}\`, 'bot').catch(() => {});\n        }\n        return;\n    }\n\n`;
    if (!source.includes(activityMarker)) throw new Error('Signal patch: Twitch activity marker missing');
    source = source.replace(activityMarker, `${twitchBlock}${activityMarker}`);
  }

  return source;
});

patch('src/services/signal-system.ts', (source) => {
  const helperName = 'async function resolveDiscordStreamHubSignalDestination()';
  if (!source.includes(helperName)) {
    const marker = 'function boldSignalText(value: string): string {';
    const helper = `async function resolveDiscordStreamHubSignalDestination(): Promise<{ guildId: string; channelId: string }> {\n  const base = String(process.env.DISCORD_STREAM_HUB_URL || process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL || 'https://discord-stream-hub-new.fly.dev').replace(/\\/$/, '');\n  const secret = String(process.env.DSH_SERVICE_SECRET || process.env.DSH_CLIENT_SECRET || process.env.BOT_SECRET_KEY || '').trim();\n  if (!secret) throw new Error('DSH service secret is not configured');\n  const response = await fetch(\`\${base}/api/internal/signal/channel\`, {\n    headers: { Authorization: \`Bearer \${secret}\` },\n    cache: 'no-store',\n    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'\n      ? AbortSignal.timeout(5000)\n      : undefined,\n  });\n  if (!response.ok) {\n    throw new Error(\`Signal destination lookup failed: \${response.status} \${await response.text().catch(() => '')}\`);\n  }\n  const payload = await response.json().catch(() => null) as any;\n  const guildId = String(payload?.guildId || '').trim();\n  const channelId = String(payload?.channelId || '').trim();\n  if (!guildId || !channelId) throw new Error('DSH Signal destination response was incomplete');\n  return { guildId, channelId };\n}\n\n`;
    if (!source.includes(marker)) throw new Error('Signal patch: bold signal marker missing');
    source = source.replace(marker, `${helper}${marker}`);
  }

  const oldDestination = `  const guildId = await getDiscordStreamHubDefaultGuildId();\n  const channelId = await resolveSignalChannelId(guildId);\n  if (!channelId) throw new Error(\`\${SIGNAL_CHANNEL_NAME} was not found in the Space Mountain Discord.\`);`;
  const newDestination = `  const { guildId, channelId } = await resolveDiscordStreamHubSignalDestination();`;
  if (!source.includes(newDestination)) {
    if (!source.includes(oldDestination)) throw new Error('Signal patch: Twitch destination marker missing');
    source = source.replace(oldDestination, newDestination);
  }

  const signatureMarker = `  rawMessage: string;\n}): Promise<SignalCommandResult> {`;
  const signatureWithDefer = `  rawMessage: string;\n  deferAcknowledgement?: boolean;\n}): Promise<SignalCommandResult> {`;
  if (!source.includes('deferAcknowledgement?: boolean;')) {
    if (!source.includes(signatureMarker)) throw new Error('Signal patch: Twitch Signal signature marker missing');
    source = source.replace(signatureMarker, signatureWithDefer);
  }

  const oldAcknowledgement = `  await sendChatMessage(\`📡 SIGNAL ACKNOWLEDGED — transmission accepted from @\${input.username}.\`, 'bot', targetName, SIGNAL_TWITCH_TENANT_ID).catch((error) => {\n    console.warn('[Signal] Discord carrier posted but SpaceMountainLive Twitch acknowledgement failed', error);\n  });\n  return { handled: true, ok: true, messageId: posted?.messageId || null };`;
  const newAcknowledgement = `  const acknowledgement = \`📡 SIGNAL ACKNOWLEDGED — transmission accepted from @\${input.username}.\`;\n  if (!input.deferAcknowledgement) {\n    await sendChatMessage(acknowledgement, 'bot', targetName, SIGNAL_TWITCH_TENANT_ID).catch((error) => {\n      console.warn('[Signal] Discord carrier posted but SpaceMountainLive Twitch acknowledgement failed', error);\n    });\n  }\n  return { handled: true, ok: true, message: acknowledgement, messageId: posted?.messageId || null };`;
  if (!source.includes('const acknowledgement = `📡 SIGNAL ACKNOWLEDGED')) {
    if (!source.includes(oldAcknowledgement)) throw new Error('Signal patch: Twitch acknowledgement marker missing');
    source = source.replace(oldAcknowledgement, newAcknowledgement);
  }

  return source;
});

patch('src/services/twitch-client.ts', (source) => {
  const channelSetMarker = 'const communityBotChannels = new Set<string>();';
  const signalCarrierSet = 'const signalCarrierChannels = new Set<string>();';
  if (!source.includes(signalCarrierSet)) {
    if (!source.includes(channelSetMarker)) throw new Error('Signal patch: community bot channel set marker missing');
    source = source.replace(channelSetMarker, `${channelSetMarker}\n${signalCarrierSet}`);
  }

  if (!source.includes('const isSignalCarrier = signalCarrierChannels.has(channelName);')) {
    const oldBlock = `          const tenantId = channelToTenant.get(channelName);\n          if (!tenantId) return;\n          const tenant = tenantClients.get(tenantId);\n          if (tenant && !shouldDispatchIncomingFromCommunityBot(tenant.broadcasterClient)) {\n            return;\n          }\n\n          if (!self && tenantsNeedingReauth.has(tenantId) && String(message || '').startsWith('!')) {\n            await sendReauthNotice(client, channelName, tenantId, tags?.username || tags?.['display-name']);\n            return;\n          }\n\n          await dispatchIncomingTwitchMessage(channel, tags, message, self, tenantId);`;
    const newBlock = `          const tenantId = channelToTenant.get(channelName);\n          const isSignalCarrier = signalCarrierChannels.has(channelName);\n          if (!tenantId && !isSignalCarrier) return;\n          const tenant = tenantId ? tenantClients.get(tenantId) : undefined;\n          if (tenant && !shouldDispatchIncomingFromCommunityBot(tenant.broadcasterClient)) {\n            return;\n          }\n\n          if (!tenantId && isSignalCarrier) {\n            if (self) return;\n            const username = String(tags?.username || tags?.['display-name'] || 'viewer').trim();\n            const carrierMessage = String(message || '');\n            const sayCarrierReply = async (text: string): Promise<boolean> => {\n              try {\n                await client.say(channelName, text);\n                return true;\n              } catch (error) {\n                console.error(\`[Twitch:community-bot] Failed to reply in carrier #\${channelName}:\`, error);\n                return false;\n              }\n            };\n\n            if (/^!signal(?:\\s|$)/i.test(carrierMessage)) {\n              const { handleTwitchSignalCommand } = await import('./signal-system');\n              try {\n                const result = await handleTwitchSignalCommand({\n                  providerUserId: String(tags?.['user-id'] || ''),\n                  username,\n                  broadcaster: channelName,\n                  rawMessage: carrierMessage,\n                  deferAcknowledgement: true,\n                });\n                if (result.message) {\n                  await sayCarrierReply(result.message);\n                }\n              } catch (error: any) {\n                console.error('[Twitch:community-bot] Carrier !signal failed:', error);\n                await sayCarrierReply(\`@\${username}, Signal failed: \${error?.message || 'unknown error'}\`);\n              }\n              return;\n            }\n\n            if (!/(^|[^a-z0-9_])@?(?:athena|annie|athenabot87)(?:[^a-z0-9_]|$)/i.test(carrierMessage)) return;\n            try {\n              const { handleTwitchCarrierAthenaCall } = await import('./carrier-athena');\n              const athenaResult = await handleTwitchCarrierAthenaCall({\n                username,\n                displayName: String(tags?.['display-name'] || username),\n                channel: channelName,\n                message: carrierMessage,\n              });\n              if (athenaResult.handled && athenaResult.message) {\n                await sayCarrierReply(athenaResult.message);\n              }\n            } catch (error: any) {\n              console.error('[Twitch:community-bot] Carrier Athena dispatch failed:', error);\n              await sayCarrierReply(\`@\${username}, Athena failed: \${error?.message || 'unknown error'}\`);\n            }\n            return;\n          }\n\n          if (!self && tenantId && tenantsNeedingReauth.has(tenantId) && String(message || '').startsWith('!')) {\n            await sendReauthNotice(client, channelName, tenantId, tags?.username || tags?.['display-name']);\n            return;\n          }\n\n          await dispatchIncomingTwitchMessage(channel, tags, message, self, tenantId);`;
    if (!source.includes(oldBlock)) throw new Error('Signal patch: community bot message handler marker missing');
    source = source.replace(oldBlock, newBlock);
  }

  if (!source.includes('export async function syncSignalCarrierChannels(')) {
    const marker = 'async function sendReauthNotice(client: tmi.Client, channel: string, tenantId: string, username?: string): Promise<void> {';
    const block = `function normalizeSignalCarrierChannel(value: string): string {\n  return String(value || '').replace(/^#/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);\n}\n\nexport async function syncSignalCarrierChannels(channels: string[]): Promise<{ active: string[]; joined: string[]; parted: string[] }> {\n  const clientId = process.env.TWITCH_CLIENT_ID;\n  const clientSecret = process.env.TWITCH_CLIENT_SECRET;\n  if (!clientId || !clientSecret) throw new Error('Twitch client credentials are not configured');\n\n  const next = new Set((channels || []).map(normalizeSignalCarrierChannel).filter(Boolean));\n  const joined: string[] = [];\n  const parted: string[] = [];\n\n  for (const channel of next) {\n    if (!communityBotChannels.has(channel)) {\n      const client = await ensureCommunityBotForChannel(channel, clientId, clientSecret);\n      if (!client || !communityBotChannels.has(channel)) {\n        throw new Error(\`Community bot could not join Signal carrier #\${channel}\`);\n      }\n      joined.push(channel);\n    }\n    signalCarrierChannels.add(channel);\n  }\n\n  for (const channel of [...signalCarrierChannels]) {\n    if (next.has(channel)) continue;\n    signalCarrierChannels.delete(channel);\n    if (channelToTenant.has(channel)) continue;\n    if (communityBotClient && communityBotChannels.has(channel)) {\n      try {\n        await communityBotClient.part(channel);\n      } catch (error) {\n        console.warn(\`[Twitch:community-bot] Failed to part removed Signal carrier #\${channel}:\`, error);\n      }\n      communityBotChannels.delete(channel);\n      parted.push(channel);\n    }\n  }\n\n  return { active: [...signalCarrierChannels].sort(), joined, parted };\n}\n\n`;
    if (!source.includes(marker)) throw new Error('Signal patch: reauth notice marker missing');
    source = source.replace(marker, `${block}${marker}`);
  }

  return source;
});

patch('server.ts', (source) => {
  const marker = "        const serverHost = process.env.SERVER_HOST || (isProductionRuntime ? '0.0.0.0' : appConfig?.server?.host || '127.0.0.1');";
  if (!source.includes(marker)) throw new Error('Signal patch: server startup marker missing');

  if (!source.includes('startSignalCarrierRosterSync();')) {
    const carrierBlock = `        try {\n            const { startSignalCarrierRosterSync } = await import('./src/services/signal-carrier-sync');\n            startSignalCarrierRosterSync();\n            console.log('[Signal] DSH shoutout carrier listener armed');\n        } catch (error) {\n            console.warn('[Signal] Carrier listener startup skipped:', error);\n        }\n\n`;
    source = source.replace(marker, `${carrierBlock}${marker}`);
  }

  if (!source.includes('startSignalScheduler();')) {
    const schedulerBlock = `        if (process.env.SIGNAL_SCHEDULER_ENABLED === 'true') {\n            try {\n                const { startSignalScheduler } = await import('./src/services/signal-system');\n                startSignalScheduler();\n                console.log('[Signal] Lost Signal scheduler armed');\n            } catch (error) {\n                console.warn('[Signal] Scheduler startup skipped:', error);\n            }\n        } else {\n            console.log('[Signal] Lost Signal scheduler disabled until SIGNAL_SCHEDULER_ENABLED=true');\n        }\n\n`;
    source = source.replace(marker, `${schedulerBlock}${marker}`);
  }

  return source;
});