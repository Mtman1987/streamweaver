from pathlib import Path

p = Path('src/services/chat-dispatcher.ts')
s = p.read_text()

old = "import { findDiscordLastSeenForNames } from './discord-last-seen';"
new = "import { findDiscordLastSeenForNames, findDiscordLastSeenForUserId } from './discord-last-seen';\nimport { lookupDiscordRelayPresence } from './discord-relay-presence';"
assert old in s, 'relay last-seen import not found'
s = s.replace(old, new, 1)

old = """        const resolvedTargetTenantId = targetTenantId!;
        const broadcasterChannel = await getTenantBroadcasterChannel(resolvedTargetTenantId);
        const liveLookup = await lookupDiscordStreamHubTwitchTarget(broadcasterChannel);
        const shouldTryDmBackup = liveLookup?.isLive !== true;
        console.log('[Dispatcher] Bot relay delivery target resolved:', {
            targetTenantId: resolvedTargetTenantId,
            broadcasterChannel,
            targetBot: input.target.currentName,
            liveLookup,
            firstDelivery: 'twitch-chat',
            shouldTryDmBackup,
        });"""
new = """        const resolvedTargetTenantId = targetTenantId!;
        const broadcasterChannel = await getTenantBroadcasterChannel(resolvedTargetTenantId);
        const liveLookup = await lookupDiscordStreamHubTwitchTarget(broadcasterChannel).catch(() => null);
        const twitchIsLive = liveLookup?.isLive === true;
        const targetDiscordConfig = await readDiscordConfig(resolvedTargetTenantId).catch(() => null);
        const linkedDiscordUserId = String(targetDiscordConfig?.discordUserId || '').trim();
        const linkedDiscordGuildId = String(targetDiscordConfig?.guildId || '').trim();
        const discordPresence = linkedDiscordUserId
            ? await lookupDiscordRelayPresence(linkedDiscordUserId, linkedDiscordGuildId || undefined).catch(() => null)
            : null;
        console.log('[Dispatcher] Bot relay delivery target resolved:', {
            targetTenantId: resolvedTargetTenantId,
            broadcasterChannel,
            targetBot: input.target.currentName,
            liveLookup,
            twitchIsLive,
            linkedDiscordUserId: linkedDiscordUserId || null,
            discordPresence: discordPresence ? {
                inVoice: discordPresence.inVoice,
                recentlyChatting: discordPresence.recentlyChatting,
                preferredKind: discordPresence.preferredKind,
                preferredChannelId: discordPresence.preferredChannelId,
            } : null,
            firstDelivery: twitchIsLive ? 'twitch-chat' : (discordPresence?.preferredChannelId ? `discord-${discordPresence.preferredKind || 'active'}` : 'discord-dm'),
        });"""
assert old in s, 'relay target block not found'
s = s.replace(old, new, 1)

old = """        let chatDelivered = false;
        let chatError = '';
        try {
            await sendChatMessage(twitchRelayText, 'bot', broadcasterChannel, resolvedTargetTenantId);
            chatDelivered = true;
            await recordReplyPath({
                platform: 'twitch',
                channelId: broadcasterChannel,
                defaultRecipientUsername: broadcasterChannel,
                history: relayHistory,
            }).catch((error) => console.warn('[Dispatcher] Failed to record Twitch relay reply path:', error));
        } catch (error: any) {
            chatError = error?.message || 'unknown Twitch chat error';
            console.warn('[Dispatcher] Bot relay Twitch chat delivery failed:', {
                targetTenantId: resolvedTargetTenantId,
                broadcasterChannel,
                targetBot: input.target.currentName,
                error: chatError,
            });
        }

        if (!shouldTryDmBackup) {"""
new = """        let chatDelivered = false;
        let chatError = '';
        if (twitchIsLive) {
            try {
                await sendChatMessage(twitchRelayText, 'bot', broadcasterChannel, resolvedTargetTenantId);
                chatDelivered = true;
                await recordReplyPath({
                    platform: 'twitch',
                    channelId: broadcasterChannel,
                    defaultRecipientUsername: broadcasterChannel,
                    history: relayHistory,
                }).catch((error) => console.warn('[Dispatcher] Failed to record Twitch relay reply path:', error));
            } catch (error: any) {
                chatError = error?.message || 'unknown Twitch chat error';
                console.warn('[Dispatcher] Bot relay live Twitch delivery failed; continuing to Discord fallbacks:', {
                    targetTenantId: resolvedTargetTenantId,
                    broadcasterChannel,
                    targetBot: input.target.currentName,
                    error: chatError,
                });
            }
        }

        if (twitchIsLive && chatDelivered) {"""
assert old in s, 'relay twitch delivery block not found'
s = s.replace(old, new, 1)

old = """            const discordLastSeen = await findDiscordLastSeenForNames([
                broadcasterChannel,
                input.target.currentName,
                ...(input.target.aliases || []),
                ...(input.target.previousNames || []),
            ]);
            if (!discordLastSeen?.channelId) {
                throw new Error(`${input.target.currentName} has no Discord last-seen channel`);
            }"""
new = """            const presenceChannelId = String(discordPresence?.preferredChannelId || '').trim();
            const idLastSeen = linkedDiscordUserId
                ? await findDiscordLastSeenForUserId(linkedDiscordUserId).catch(() => null)
                : null;
            const nameLastSeen = !idLastSeen
                ? await findDiscordLastSeenForNames([
                    broadcasterChannel,
                    input.target.currentName,
                    ...(input.target.aliases || []),
                    ...(input.target.previousNames || []),
                ]).catch(() => null)
                : null;
            const fallbackLastSeen = idLastSeen || nameLastSeen;
            const fallbackAgeMs = fallbackLastSeen?.lastSeenAt
                ? Date.now() - new Date(fallbackLastSeen.lastSeenAt).getTime()
                : Number.POSITIVE_INFINITY;
            const recentFallback = fallbackLastSeen && fallbackAgeMs >= 0 && fallbackAgeMs <= 10 * 60 * 1000
                ? fallbackLastSeen
                : null;
            const discordLastSeen = presenceChannelId
                ? {
                    userId: linkedDiscordUserId || discordPresence?.userId,
                    username: discordPresence?.username || targetDiscordConfig?.discordUsername,
                    displayName: discordPresence?.displayName || targetDiscordConfig?.discordUsername,
                    guildId: discordPresence?.guildId || linkedDiscordGuildId,
                    channelId: presenceChannelId,
                    channelName: discordPresence?.preferredChannelName || undefined,
                    tenantId: resolvedTargetTenantId,
                    lastSeenAt: discordPresence?.voiceObservedAt || discordPresence?.lastChatAt || new Date().toISOString(),
                }
                : recentFallback;
            if (!discordLastSeen?.channelId) {
                throw new Error(`${input.target.currentName} is not currently active in Discord`);
            }"""
assert old in s, 'relay discord lookup block not found'
s = s.replace(old, new, 1)

p.write_text(s)
print('relay routing patch applied')
