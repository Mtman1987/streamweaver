import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { apiOk } from '@/lib/api-response';
import { getBotAliases, getBotName } from '@/lib/bot-settings-store';
import { readUserConfigSync } from '@/lib/user-config';
import { getAdminTwitchId, listTenants } from '@/lib/tenant';
import { appendBotInteraction, decideBotInteraction, getBotShareMode, toggleBotShareMode } from '@/lib/bot-interactions-store';
import { readWorldLore, type WorldLoreCharacter } from '@/lib/world-lore-store';
import { promises as fs } from 'fs';
import { getGenMode, setGenMode, toggleGenMode } from '@/lib/gen-mode-store';
import { readGenerationSettings } from '@/lib/gen-settings-store';
import { readDiscordConfig, updateDiscordConfig } from '@/lib/discord-config';
import { getConfiguredAppUrl, getInternalAppUrl } from '@/lib/runtime-origin';
import { resolveDiscordBotTenantId } from '@/services/discord-branding';
import { buildStructuredDiscordReplyPayload, sendStructuredDiscordReply } from '@/services/discord-structured-replies';
import { isBotTriggerIgnored, toggleBotTriggerIgnoreAll, toggleIgnoredBotTrigger } from '@/lib/bot-trigger-ignore-store';
import { processDueDiscordMessageCleanups, recordDiscordMessageCleanup } from '@/services/discord-message-cleanup';
import { appendPublicChatMessages } from '@/lib/public-chat-store';
import {
  buildDirectHumanRelayMessage,
  deliverBotRelay,
  handleBotRelayReply,
  handleDiscordMessage,
  isDirectHumanRelayTarget,
  resolveHumanRelaySpeaker,
  resolveRelayTarget,
} from '@/services/chat-dispatcher';
import { markDmMessageHandled } from '@/services/discord-dm-sweep-state';
import { registerHandledDiscordMessagePersisted } from '@/services/discord-message-dedupe';
import { hasDiscordModAccess } from '@/services/discord-permissions';
import { checkDiscordStreamHubAdminAccess } from '@/services/discord-stream-hub';
import { detectBotRelayRequest, detectBotRelayRequestWithAi } from '@/services/bot-relay';
import { recordDiscordLastSeen } from '@/services/discord-last-seen';
import { parseDiscordChatPayload } from '@/lib/discord-chat-payload';
import { internalServiceHeaders } from '@/lib/internal-service-auth';
import { readPrivateChatSettings } from '@/lib/private-chat-settings-store';
import {
  beginPendingMtSupportRequest,
  consumePendingMtSupportRequest,
  detectMtFixItIntent,
  getMtFixItPublicReply,
  getMtSupportPrompt,
  submitMtSupportReport,
} from '@/services/mt-support-report';
import { canUsePublicImageGeneration, runImageCommand } from '@/services/image-command';
import { isImagePromptModerationError } from '@/services/image-content-moderation';
import { queueTtsOverlay } from '@/services/tts-overlay-queue';
import { registerPrivateImageCarousel } from '@/services/private-image-carousel';
import { deleteMessage } from '@/services/discord-local';
import { replaceDiscordUserMentions, resolveDiscordUserMention } from '@/services/discord-mentions';
import { detectOpenBotCommandWithAi, runOpenBotCommand } from '@/services/open-bot-commands';
import { recordSharedChatDeadLetter, recordSharedChatEvent } from '@/services/shared-chat-ingestion';
import { normalizeDiscordSharedChatEvent } from '@/services/shared-chat-normalizers';
import {
  applySayState,
  formatSaySpeechText,
  isSayEnabled,
  isSayTextSpeakable,
  parseSayState,
  readSayUsers,
  resolveSayStreamKey,
  sayAllKey,
  sayUserKey,
  buildSayPlayerUrl,
  hasSayEnabledInChannel,
  writeSayUsers,
} from '@/services/say-tts';

const DISCORD_DM_IMAGE_COMMANDS_ENABLED = process.env.DISCORD_DM_IMAGE_COMMANDS_ENABLED !== 'false';
const VERBOSE_LOGS = process.env.STREAMWEAVER_VERBOSE_LOGS === 'true';
const PERMANENT_OWNER_DISCORD_IDS = new Set([
  '767875979561009173',
  String(process.env.STREAMWEAVER_OWNER_DISCORD_ID || '').trim(),
  String(process.env.NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID || '').trim(),
].filter(Boolean));

function logDiscordTrace(traceId: string, stage: string, details: Record<string, unknown> = {}) {
  console.log(`[DiscordTrace] ${JSON.stringify({
    traceId,
    service: 'streamweaver',
    stage,
    ...details,
  })}`);
}

type NormalizedDiscordPayload = {
  raw: any;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  channelType: string | number;
  messageId: string;
  message: string;
  createdAt: string;
  dispatch: boolean;
  tenantId?: string;
  isDirectMessage: boolean;
  isAdmin?: boolean;
  isMod?: boolean;
  isOwner?: boolean;
  memberPermissions?: string[] | string;
};

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function normalizeDiscordPayload(body: any): NormalizedDiscordPayload {
  const data = body?.root || body || {};
  const author = data.author || data.member?.user || data.user || {};
  const channel = data.channel || {};
  const guild = data.guild || {};
  const member = data.member || {};
  const channelType = data.channelType ?? data.channel_type ?? channel.type ?? '';
  const guildId = firstString(data.guildId, data.guild_id, guild.id);
  const channelId = firstString(data.channelId, data.channel_id, channel.id);
  const message = firstString(data.message, data.content, data.cleanContent);

  return {
    raw: data,
    userId: firstString(data.userId, data.user_id, author.id, member.user?.id),
    username: firstString(data.userName, data.username, author.username, member.user?.username, data.displayName, member.displayName, member.nick, 'Unknown'),
    displayName: firstString(data.displayName, data.globalName, member.displayName, member.nick, author.global_name, author.username, data.userName, data.username, 'Unknown'),
    avatarUrl: firstString(data.userAvatar, data.avatarUrl, data.avatar_url, author.avatarUrl, author.displayAvatarURL),
    guildId,
    guildName: firstString(data.guildName, data.guild_name, guild.name),
    channelId,
    channelName: firstString(data.channelName, data.channel_name, channel.name),
    channelType,
    messageId: firstString(data.messageId, data.message_id, data.id),
    message,
    createdAt: firstString(data.createdAt, data.created_at, data.timestamp),
    dispatch: data.dispatch !== false,
    tenantId: firstString(data.tenantId, data.twitchId, data.tenant_id, data.twitch_id) || undefined,
    isDirectMessage: Boolean(
      data.isDM ||
      data.isDirectMessage ||
      data.is_direct_message ||
      channelType === 'DM' ||
      channelType === 1 ||
      channelType === '1' ||
      !guildId
    ),
    isAdmin: data.isAdmin,
    isMod: data.isMod,
    isOwner: data.isOwner,
    memberPermissions: data.memberPermissions || data.member_permissions || member.permissions,
  };
}

function isDiscordBotAuthor(data: any): boolean {
  return Boolean(
    data?.bot ||
    data?.isBot ||
    data?.author?.bot ||
    data?.member?.user?.bot ||
    data?.user?.bot
  );
}

/**
 * POST /api/discord/chat
 * 
 * Receives Discord messages from external bot (same payload as discordstreamhub).
 * If the bot is mentioned, generates an AI response and replies via webhook.
 * Also bridges to Twitch chat if discord bridge is enabled.
 */
export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      const raw = await request.text();
      body = parseDiscordChatPayload(raw);
      if (!body) {
        return apiOk({ success: false, skipped: 'invalid-json' });
      }
    } catch (error) {
      console.log('[Discord Chat] Rejected malformed JSON payload:', error instanceof Error ? error.message : String(error));
      return apiOk({ success: false, skipped: 'invalid-json' });
    }

    const normalized = normalizeDiscordPayload(body);
    const data = normalized.raw;
    const userId = normalized.userId;
    const guildId = normalized.guildId;
    const userName = normalized.displayName || normalized.username;
    const userAvatar = normalized.avatarUrl;
    const rawMessage = normalized.message;
    const message = replaceDiscordUserMentions(rawMessage, data);
    const channelId = normalized.channelId;
    const dispatch = normalized.dispatch;
    const isDirectMessage = normalized.isDirectMessage;
    const relayOnly =
      request.headers.get('x-discord-reply-mode') === 'collect' ||
      request.headers.get('x-chat-origin') === 'dsh-fanout';
    const traceId = request.headers.get('x-discord-trace-id') || normalized.messageId || randomUUID();
    const collectedReplies: Array<Record<string, unknown>> = [];
    processDueDiscordMessageCleanups().catch((error) => console.warn('[Discord Chat] Cleanup sweep failed:', error));

    logDiscordTrace(traceId, 'ingress', {
      source: request.headers.get('x-chat-origin') || 'direct',
      replyMode: relayOnly ? 'collect' : 'direct',
      guildId: guildId || null,
      channelId: channelId || null,
      messageId: normalized.messageId || null,
      userId: userId || null,
      userName,
      isDirectMessage,
      isBotAuthor: isDiscordBotAuthor(data),
      dispatch,
      messageLength: message.length,
      messagePreview: isDirectMessage ? '[private message]' : message.slice(0, 120),
    });

    const collectReply = (payload: string | Record<string, unknown>) => {
      if (typeof payload === 'string') {
        collectedReplies.push({ content: payload, allowed_mentions: { parse: [] } });
        return;
      }
      collectedReplies.push({
        ...payload,
        allowed_mentions: (payload as any)?.allowed_mentions || { parse: [] },
      });
    };

    const sendDiscordRouteReplyOrCollect = async (
      replyChannelId: string,
      replyMessage: string,
      username = 'StreamWeaver',
      responseType?: string,
      imageUrl?: string,
      privateControls?: {
        gifEnabled?: boolean;
        ttsEnabled?: boolean;
        adultMode?: boolean;
        includeConfiguredMedia?: boolean;
      },
    ) => {
      if (!replyChannelId) return;
      const structuredInput = {
        channelId: replyChannelId,
        message: replyMessage,
        tenantId,
        botName: username === 'StreamWeaver' ? undefined : username,
        responseType,
        rotateSpeaker: username === 'StreamWeaver' && message.trim().startsWith('!'),
        sourceMessageId: normalized.messageId,
        sourceMessage: message,
        sourceUser: userName,
        sourceUserAvatarUrl: userAvatar,
        isPrivate: isDirectMessage,
        imageUrl,
        ...privateControls,
      };
      if (relayOnly) {
        const payload = await buildStructuredDiscordReplyPayload(structuredInput);
        collectReply({ content: payload.content, embeds: payload.embeds, username: payload.username });
        return;
      }
      return sendStructuredDiscordReply(structuredInput);
    };

    const isFirstSeen = await registerHandledDiscordMessagePersisted({
      messageId: normalized.messageId,
      channelId,
      userId,
      username: normalized.username,
      content: message,
      createdAt: normalized.createdAt,
    });
    if (!isFirstSeen) {
      console.log('[Discord Chat] Skipping duplicate message:', {
        messageId: normalized.messageId || null,
        channelId: channelId || null,
        isDirectMessage,
      });
      logDiscordTrace(traceId, 'skipped', {
        reason: isDirectMessage ? 'duplicate-private-message' : 'duplicate-public-message',
      });
      return apiOk({ success: true, botResponded: false, duplicate: true });
    }

    if (!isDirectMessage) {
      recordDiscordLastSeen({
        userId,
        username: normalized.username,
        displayName: userName,
        guildId,
        guildName: normalized.guildName,
        channelId,
        channelName: normalized.channelName,
        messageId: normalized.messageId,
        tenantId: normalized.tenantId,
        createdAt: normalized.createdAt,
      }).catch((error) => console.warn('[Discord Chat] Last-seen record failed:', error));
    }

    const permissionFieldsPresent =
      normalized.isAdmin !== undefined ||
      normalized.isMod !== undefined ||
      normalized.isOwner !== undefined ||
      normalized.memberPermissions !== undefined;
    const permissions = Array.isArray(normalized.memberPermissions)
      ? normalized.memberPermissions
      : String(normalized.memberPermissions || '').split(/[,\s]+/).filter(Boolean);
    const permanentOwner = PERMANENT_OWNER_DISCORD_IDS.has(userId);
    const dshAccess = permanentOwner
      ? { isAdmin: true, isMod: true, isOwner: true, matchedBy: 'permanent-owner' }
      : await checkDiscordStreamHubAdminAccess({ guildId, userId });
    const effectiveIsAdmin = Boolean(normalized.isAdmin || dshAccess?.isAdmin);
    const effectiveIsMod = Boolean(normalized.isMod || dshAccess?.isMod);
    const effectiveIsOwner = Boolean(normalized.isOwner || dshAccess?.isOwner);
    const canManageBotShare = !permissionFieldsPresent || hasDiscordModAccess({
      isAdmin: effectiveIsAdmin,
      isMod: effectiveIsMod,
      isOwner: effectiveIsOwner,
      memberPermissions: permissions,
    });

    if (!message || message.length === 0) {
      return apiOk({ success: true, skipped: 'empty message' });
    }

    if (VERBOSE_LOGS) {
      console.log('[Discord Chat] Incoming message:', {
        userId,
        username: normalized.username,
        displayName: normalized.displayName,
        guildId,
        guildName: normalized.guildName,
        channelId,
        channelName: normalized.channelName,
        channelType: normalized.channelType,
        messageId: normalized.messageId,
        isDirectMessage,
        dispatch,
        messagePreview: message.slice(0, 100),
      });
    }

    const isPrivateDiscordLane = isDirectMessage;
    let tenantId = normalized.tenantId;
    let tenantResolution = tenantId ? 'payload' : 'none';
    if (!tenantId) {
      tenantId = isPrivateDiscordLane
        ? await resolveGuildTenant('', channelId)
        : await resolveDiscordAuthorTenant(userId, userName);
      tenantResolution = tenantId ? (isPrivateDiscordLane ? 'dm-channel' : 'discord-author') : 'none';
    }
    if (!tenantId && !isPrivateDiscordLane && dshAccess?.isOwner) {
      const ownerTenantId = getAdminTwitchId().trim();
      if (ownerTenantId && (await listTenants()).includes(ownerTenantId)) {
        tenantId = ownerTenantId;
        tenantResolution = 'discord-owner';
      }
    }
    logDiscordTrace(traceId, 'tenant-resolved', {
      payloadTenantId: normalized.tenantId || null,
      resolvedTenantId: tenantId || null,
      resolution: tenantResolution,
      guildId: guildId || null,
      channelId: channelId || null,
    });

    if (tenantId && message) {
      try {
        await recordSharedChatEvent(normalizeDiscordSharedChatEvent({
          tenantId,
          payload: data,
          message,
          traceId,
        }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn('[SharedChat] Discord ingestion failed:', reason);
        recordSharedChatDeadLetter({
          tenantId,
          source: 'discord',
          reason,
          payload: {
            traceId,
            messageId: normalized.messageId || null,
            guildId: guildId || null,
            channelId: channelId || null,
          },
        }).catch((deadLetterError) => console.warn('[SharedChat] Discord dead-letter write failed:', deadLetterError));
      }
    }

    if (!isPrivateDiscordLane) {
      const mtFixItIntent = detectMtFixItIntent(message);
      if (mtFixItIntent.matched) {
        if (!mtFixItIntent.description) {
          beginPendingMtSupportRequest({
            platform: 'discord',
            tenantId,
            username: userName,
            channelId,
          });
          await sendDiscordRouteReplyOrCollect(channelId, `@${userName}, ${getMtSupportPrompt('discord')}`);
          return apiOk({ success: true, botResponded: true, supportReportPending: true, replies: relayOnly ? collectedReplies : undefined });
        }

        const result = await submitMtSupportReport({
          platform: 'discord',
          tenantId,
          username: userName,
          reporterId: userId,
          channelId,
          description: mtFixItIntent.description,
          triggerMessage: message,
        });
        if (!result.ok) console.error('[MtFixIt] Discord route inline report failed:', result.error);
        await sendDiscordRouteReplyOrCollect(channelId, getMtFixItPublicReply(userName));
        return apiOk({ success: true, botResponded: true, supportReportSent: result.ok, replies: relayOnly ? collectedReplies : undefined });
      }

      if (consumePendingMtSupportRequest({
        platform: 'discord',
        tenantId,
        username: userName,
        channelId,
      })) {
        const pendingDescription = message.trim().startsWith('!') ? message.trim().slice(1).trim() : message;
        const pendingResult = await submitMtSupportReport({
          platform: 'discord',
          tenantId,
          username: userName,
          reporterId: userId,
          channelId,
          description: pendingDescription,
          triggerMessage: '!mtfixit',
        });
        if (!pendingResult.ok) console.error('[MtFixIt] Discord route pending-description report failed:', pendingResult.error);
        await sendDiscordRouteReplyOrCollect(channelId, getMtFixItPublicReply(userName));
        return apiOk({ success: true, botResponded: true, supportReportSent: pendingResult.ok, replies: relayOnly ? collectedReplies : undefined });
      }
    }

    if (!isPrivateDiscordLane) {
      appendPublicChatMessages([{
        type: 'user',
        username: userName,
        message,
        timestamp: normalized.createdAt || new Date().toISOString(),
      }], 300, tenantId).catch((error) => {
        console.warn('[Discord Chat] Failed to append public chat history:', error);
      });
    }

    // Auto-save guildId to the tenant's single Discord runtime config if not set yet.
    if (!tenantId && guildId) {
      // Can't auto-assign without knowing which tenant — skip
    } else if (tenantId && guildId) {
      // Ensure guildId is persisted in their config
      try {
        const dcConfig = await readDiscordConfig(tenantId);
        if (!dcConfig.guildId) {
          await updateDiscordConfig({ guildId }, tenantId);
          console.log(`[Discord Chat] Auto-saved guildId ${guildId} for tenant ${tenantId}`);
        }
      } catch {}
    }

    const msgLower = message.toLowerCase();
    const botShareMatch = msgLower.trim().match(/^!botshare(?:\s+(on|off|status))?$/);
    if (botShareMatch) {
      const replyChannelId = channelId || await getDiscordLogChannelId(tenantId);
      console.log('[Discord Chat] !botshare command received:', {
        tenantId: tenantId || null,
        guildId: guildId || null,
        channelId: channelId || null,
        replyChannelId: replyChannelId || null,
        action: botShareMatch[1] || 'toggle',
        canManageBotShare,
        isDirectMessage,
        payloadKeys: Object.keys(data),
      });
      if (!tenantId) {
        return apiOk({ success: true, botResponded: false, error: 'tenant-not-found' });
      }
      if (!canManageBotShare) {
        if (replyChannelId) {
          await sendDiscordRouteReplyOrCollect(replyChannelId, `@${userName}, only mods/admins can change bot share mode.`);
        }
        return apiOk({ success: true, botResponded: true, error: 'not-authorized', replies: relayOnly ? collectedReplies : undefined });
      }
      let mode;
      if (botShareMatch[1] === 'on' || botShareMatch[1] === 'off') {
        const { setBotShareMode } = await import('@/lib/bot-interactions-store');
        mode = await setBotShareMode(botShareMatch[1], tenantId);
      } else if (botShareMatch[1] === 'status') {
        const { getBotShareMode } = await import('@/lib/bot-interactions-store');
        mode = await getBotShareMode(tenantId);
      } else {
        mode = await toggleBotShareMode(tenantId);
      }
      if (replyChannelId) {
        await sendDiscordRouteReplyOrCollect(replyChannelId, `Bot share mode: ${mode.toUpperCase()} - cross-bot replies are ${mode === 'on' ? 'enabled' : 'disabled'}.`);
      }
      return apiOk({ success: true, botResponded: Boolean(replyChannelId), mode, replies: relayOnly ? collectedReplies : undefined });
    }

    let botMatch = await resolveMentionedBot(msgLower, tenantId);
    if (!botMatch && tenantId && !isPrivateDiscordLane) {
      const { hasPendingResearchMode } = await import('@/services/research-mode');
      if (hasPendingResearchMode({
        tenantId,
        platform: 'discord',
        channelId,
        username: normalized.username || userName,
      })) {
        botMatch = {
          tenantId,
          botName: getBotName(tenantId),
          trigger: 'research-follow-up',
          index: 0,
        };
      }
    }
    const botMentioned = Boolean(botMatch);
    logDiscordTrace(traceId, 'mention-decision', {
      mentioned: botMentioned,
      matchedBotName: botMatch?.botName || null,
      matchedTenantId: botMatch?.tenantId || null,
      matchedTrigger: botMatch?.trigger || null,
      guildTenantId: tenantId || null,
    });
    const ignoreMatch = message.trim().match(/^!ignore(?:\s+(.+))?$/i);
    if (ignoreMatch) {
      const replyChannelId = channelId || await getDiscordLogChannelId(tenantId);
      if (!tenantId) {
        return apiOk({ success: true, botResponded: false, error: 'tenant-not-found' });
      }
      if (!canManageBotShare) {
        if (replyChannelId) {
          await sendDiscordRouteReplyOrCollect(replyChannelId, `@${userName}, only mods/admins can change bot ignore settings.`);
        }
        return apiOk({ success: true, botResponded: Boolean(replyChannelId), error: 'not-authorized', replies: relayOnly ? collectedReplies : undefined });
      }

      const target = (ignoreMatch[1] || '').trim().toLowerCase().replace(/^@/, '');
      if (!target) {
        if (replyChannelId) {
          await sendDiscordRouteReplyOrCollect(replyChannelId, `@${userName}, usage: !ignore all or !ignore <bot>`);
        }
        return apiOk({ success: true, botResponded: Boolean(replyChannelId), error: 'missing-target', replies: relayOnly ? collectedReplies : undefined });
      }

      if (target === 'all') {
        const config = await toggleBotTriggerIgnoreAll(tenantId);
        if (replyChannelId) {
          await sendDiscordRouteReplyOrCollect(replyChannelId, `Bot trigger ignore-all is ${config.all ? 'ON' : 'OFF'}.`);
        }
        return apiOk({ success: true, botResponded: Boolean(replyChannelId), mode: config.all ? 'all' : 'off', replies: relayOnly ? collectedReplies : undefined });
      }

      const targetBot = await resolveMentionedBot(target, tenantId);
      const result = await toggleIgnoredBotTrigger({
        tenantId: targetBot?.tenantId || tenantId,
        botName: targetBot?.botName || target,
        trigger: targetBot?.trigger || target,
      }, tenantId);
      if (replyChannelId) {
        await sendDiscordRouteReplyOrCollect(replyChannelId, `Bot trigger ignore for ${targetBot?.botName || target}: ${result.ignored ? 'ON' : 'OFF'}.`);
      }
      return apiOk({ success: true, botResponded: Boolean(replyChannelId), ignored: result.ignored, target: result.label, replies: relayOnly ? collectedReplies : undefined });
    }

    if (isPrivateDiscordLane) {
      if (!tenantId) {
        return apiOk({ success: true, botResponded: false, error: 'tenant-not-found' });
      }
      const markHandled = () => markDmMessageHandled(tenantId!, normalized.messageId);

      const imgMatch = message.trim().match(/^!img(?:\s+(.+))?$/i);
      const gifMatch = message.trim().match(/^!gif(?:\s+(.+))?$/i);
      const genModeMatch = message.trim().match(/^!genmode(?:\s+(eden|seaart|perchance|pollinations|status))?$/i);
      if (gifMatch) {
        if (channelId) {
          await sendDiscordRouteReplyOrCollect(
            channelId,
            'Animated GIF generation is not configured yet. Use `!img <description>` for a still image.',
            getBotName(tenantId),
            'Command Help',
          );
        }
        await markHandled();
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-gif-unsupported' });
      }
      if (!DISCORD_DM_IMAGE_COMMANDS_ENABLED && (imgMatch || genModeMatch)) {
        await markHandled();
        return apiOk({ success: true, botResponded: false, tenantId, context: 'private-image-dev-mode' });
      }
      if (genModeMatch) {
        const action = (genModeMatch[1] || '').toLowerCase();
        const mode = action === 'eden' || action === 'seaart' || action === 'perchance' || action === 'pollinations'
          ? await setGenMode(action, tenantId)
          : action === 'status'
            ? await getGenMode(tenantId)
            : await toggleGenMode(tenantId);
        if (channelId) await sendDiscordRouteReplyOrCollect(channelId, `Generation mode: ${mode.toUpperCase()}`, getBotName(tenantId), 'Generation Mode');
        await markHandled();
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-genmode', mode });
      }
      if (DISCORD_DM_IMAGE_COMMANDS_ENABLED && imgMatch) {
        const prompt = (imgMatch[1] || '').trim();
        if (!prompt) {
          if (channelId) {
            const baseUrl = getConfiguredAppUrl();
            await sendDiscordRouteReplyOrCollect(
              channelId,
              `Usage: !img <description>\nPrivate image library: ${baseUrl}/api/ai/image/library?tenantId=${encodeURIComponent(tenantId)}&scope=private`,
              getBotName(tenantId),
              'Command Help',
            );
          }
          await markHandled();
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image' });
        }

        const dmSettings = await readPrivateChatSettings(tenantId).catch(() => null);
        const privateControls = {
          gifEnabled: dmSettings?.gifEnabled !== false,
          ttsEnabled: dmSettings?.ttsEnabled === true,
          adultMode: dmSettings?.adultMode === true,
          // An image command owns the frame. Do not substitute the tenant's
          // bonus GIF while generation is pending or if an explicit URL fails.
          includeConfiguredMedia: false,
        };
        let processingMessageId = '';
        const clearProcessingMessage = async () => {
          if (!processingMessageId || !channelId || relayOnly) return;
          const messageId = processingMessageId;
          processingMessageId = '';
          await deleteMessage(channelId, messageId).catch(() => undefined);
        };

        if (channelId) {
          const processing = await sendDiscordRouteReplyOrCollect(
            channelId,
            'Generating your images…',
            getBotName(tenantId),
            'Generating Image',
            undefined,
            privateControls,
          ) as any;
          processingMessageId = String(processing?.messageId || '').trim();
        }

        let result;
        try {
          result = await runImageCommand(message, tenantId, { scope: 'private' });
        } catch (error) {
          console.warn(`[Discord Chat:${tenantId}] !img failed:`, error);
          await clearProcessingMessage();
          if (channelId) {
            await sendDiscordRouteReplyOrCollect(
              channelId,
              isImagePromptModerationError(error)
                ? 'That image request was blocked by your private content safety settings.'
                : 'Image generation failed. Try again in a moment.',
              getBotName(tenantId),
              'Image Generation Failed',
            );
          }
          await markHandled();
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image', error: 'image-failed' });
        }

        if (!result.images.length) {
          await clearProcessingMessage();
          if (channelId) {
            await sendDiscordRouteReplyOrCollect(channelId, 'Image generation returned no image URL.', getBotName(tenantId), 'Image Generation Failed');
          }
          await markHandled();
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image', error: 'empty-image' });
        }

        if (channelId) {
          if (result.optimizedPrompt) {
            const settings = await readGenerationSettings(tenantId);
            if (settings.showOptimizedPrompt) {
              await sendDiscordRouteReplyOrCollect(
                channelId,
                `Optimized prompt: ${result.optimizedPrompt.slice(0, 1500)}`,
                getBotName(tenantId),
                'Optimized Prompt',
                undefined,
                privateControls,
              );
            }
          }
          const imageUrls = await Promise.all(result.images.map((image) => maybeShortenUrl(image)));
          const sent = await sendDiscordRouteReplyOrCollect(
            channelId,
            result.originalPrompt || prompt,
            getBotName(tenantId),
            'Image Generated',
            imageUrls[0],
            privateControls,
          );
          if (!relayOnly && sent?.messageId) {
            await registerPrivateImageCarousel({ tenantId, channelId, messageId: sent.messageId, images: imageUrls })
              .catch((error) => console.warn('[Discord Chat] Could not persist private image carousel:', error));
          }
          await clearProcessingMessage();
        }
        await markHandled();
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image', images: result.images });
      }

      const openCommand = await detectOpenBotCommandWithAi(message, tenantId);
      if (openCommand) {
        const botName = getBotName(tenantId);
        try {
          const openReply = await runOpenBotCommand(openCommand);
          if (channelId) {
            await sendStructuredDiscordReply({
              channelId,
              message: openReply,
              tenantId,
              botName,
              responseType: 'Command Response',
              sourceMessageId: normalized.messageId,
              sourceMessage: message,
              sourceUser: userName,
              sourceUserAvatarUrl: userAvatar,
              isPrivate: true,
            });
          }
          await markHandled();
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, botName, context: `open-${openCommand}` });
        } catch (error) {
          console.warn(`[Discord Chat:${tenantId}] Open command ${openCommand} failed:`, error);
        }
      }

      if (message.trim().startsWith('!')) {
        const dispatchResult = await handleDiscordMessage({
          content: message,
          channelId,
          channel_id: channelId,
          messageId: normalized.messageId,
          message_id: normalized.messageId,
          createdAt: normalized.createdAt,
          created_at: normalized.createdAt,
          isDM: true,
          isDirectMessage: true,
          author: {
            id: userId,
            username: normalized.username,
            globalName: userName,
            global_name: userName,
            avatarUrl: userAvatar,
            displayAvatarURL: userAvatar,
            bot: false,
          },
          mentions: data?.mentions,
          isAdmin: effectiveIsAdmin,
          isMod: effectiveIsMod,
          isOwner: effectiveIsOwner,
          memberPermissions: normalized.memberPermissions,
        }, tenantId, {
          skipPublicHistory: true,
          skipAiMentions: true,
          skipTwitchBridge: true,
          replyMode: 'structured',
        });

        if (dispatchResult.commandHandled) {
          await markHandled();
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-command' });
        }
      }

      const privateRes = await fetch(`${getInternalAppUrl()}/api/private-chat/respond`, {
        method: 'POST',
        headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          username: userName,
          message,
          tenantId,
          historyLimit: 30,
        }),
      });

      if (!privateRes.ok) {
        console.error('[Discord Chat] Private DM response failed:', privateRes.status, await privateRes.text().catch(() => ''));
        return apiOk({ success: true, botResponded: false, error: 'private-ai-failed' });
      }

      const privateData = await privateRes.json();
      const privateReply = privateData.response || privateData.data?.response || '';
      if (!privateReply) {
        return apiOk({ success: true, botResponded: false, error: 'empty-private-response' });
      }

      const dmSettings = await readPrivateChatSettings(tenantId).catch(() => null);
      if (channelId) {
        await sendDiscordBotEmbedReply(channelId, privateReply, tenantId, {
          sourceMessageId: normalized.messageId,
          sourceMessage: message,
          sourceUser: userName,
          sourceUserAvatarUrl: userAvatar,
          responseType: 'AI Answer',
          gifEnabled: dmSettings?.gifEnabled !== false,
          ttsEnabled: dmSettings?.ttsEnabled === true,
          adultMode: dmSettings?.adultMode === true,
        });
      }
      await markHandled();

      return apiOk({
        success: true,
        botResponded: Boolean(channelId),
        response: privateReply,
        tenantId,
        context: 'private',
      });
    }

    // Handle !say - standalone TTS toggle
    const sayMatch = !isPrivateDiscordLane ? rawMessage.trim().match(/^!say(?:\s+(.+))?$/i) : null;
    if (sayMatch) {
      const args = String(sayMatch[1] || '').trim().split(/\s+/).filter(Boolean);
      const firstState = parseSayState(args[0]);
      const targetToken = firstState ? '' : (args[0] || '');
      const requestedState = firstState || parseSayState(args[1]);
      const sayUsers = await readSayUsers();

      if (!targetToken || targetToken.toLowerCase() === 'all') {
        const nextState = applySayState(sayUsers, sayAllKey(channelId), requestedState);
        await writeSayUsers(sayUsers);
        if (channelId) await sendDiscordRouteReplyOrCollect(channelId, `TTS for everyone in this Discord channel is now ${nextState}. Listen: ${buildSayPlayerUrl(undefined, 'discord', channelId)}`);
        return apiOk({ success: true, botResponded: Boolean(channelId), context: 'say-toggle-all', mode: nextState });
      }

      const mentionTarget = targetToken ? resolveDiscordUserMention(targetToken, data) : null;
      if (targetToken && !mentionTarget) {
        if (channelId) await sendDiscordRouteReplyOrCollect(channelId, `@${userName}, mention the Discord user you want to update.`);
        return apiOk({ success: true, botResponded: Boolean(channelId), context: 'say-target-unresolved' });
      }

      const targetUserId = mentionTarget?.userId || userId;
      const targetName = mentionTarget?.displayName || userName;
      const isSelf = !targetToken || targetUserId === userId;
      if (!isSelf && !canManageBotShare) {
        if (channelId) await sendDiscordRouteReplyOrCollect(channelId, `@${userName}, only mods/admins can change !say for another user.`);
        return apiOk({ success: true, botResponded: Boolean(channelId), context: 'say-denied' });
      }

      const nextState = applySayState(sayUsers, sayUserKey(targetUserId, channelId), requestedState);
      await writeSayUsers(sayUsers);
      if (channelId) {
        const suffix = nextState === 'on'
          ? ` Listen: ${buildSayPlayerUrl(undefined, 'discord', channelId)}${isSelf ? '\nType !say again to disable.' : ''}`
          : '';
        await sendDiscordRouteReplyOrCollect(channelId, `@${targetName}, TTS ${nextState === 'on' ? 'enabled' : 'disabled'}.${suffix}`);
      }
      return apiOk({ success: true, botResponded: Boolean(channelId), context: 'say-toggle', mode: nextState });
    }

    // Handle !listen - global TTS link
    if (!isPrivateDiscordLane && message.trim().match(/^!listen$/i)) {
      if (channelId) {
        const links = await buildDiscordListenLinks(channelId);
        await sendDiscordRouteReplyOrCollect(channelId, links.length === 0
          ? 'No TTS listeners are on for this Discord channel. Type !say all to turn this Discord channel on.'
          : links.length === 1
          ? `Listen to TTS: ${links[0].url}\nType !say all to turn this Discord channel on.`
          : `Listen to TTS:\n${links.map((link) => `- ${link.label}: ${link.url}`).join('\n')}\nType !say all to turn this Discord channel on.`);
      }
      return apiOk({ success: true, botResponded: Boolean(channelId), context: "listen" });
    }

    // Handle !img in guild channels (not just DMs)
    if (!isPrivateDiscordLane && message.trim().match(/^!img(?:\s+(.+))?$/i)) {
      const imgMatch = message.trim().match(/^!img(?:\s+(.+))?$/i);
      const prompt = (imgMatch?.[1] || '').trim();
      if (!tenantId) {
        if (channelId) {
          await sendDiscordRouteReplyOrCollect(channelId, `@${userName}, I can't tell which StreamWeaver account owns your Discord user yet. Link Discord in StreamWeaver first, then try !img again.`);
        }
        return apiOk({ success: true, botResponded: Boolean(channelId), context: 'guild-image', error: 'tenant-unresolved' });
      }
      if (!prompt) {
        if (channelId) {
          await sendDiscordRouteReplyOrCollect(channelId, `Usage: !img <description>`);
        }
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'guild-image' });
      }
      const imageSettings = await readGenerationSettings(tenantId);
      const canUsePublicImages = canUsePublicImageGeneration(
        imageSettings.publicImageAccess,
        Boolean(effectiveIsMod || effectiveIsAdmin || effectiveIsOwner),
      );
      if (!canUsePublicImages) {
        if (channelId) {
          const accessMessage = imageSettings.publicImageAccess === 'off'
            ? 'Image generation is turned off here.'
            : 'Image generation is currently limited to moderators.';
          await sendDiscordRouteReplyOrCollect(channelId, accessMessage);
        }
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'guild-image', error: 'image-access-denied' });
      }

      if (channelId) {
        await sendDiscordRouteReplyOrCollect(channelId, "I'm processing your image now, Commander.");
      }

      let result;
      try {
        result = await runImageCommand(message, tenantId, { scope: 'public' });
      } catch (error) {
        console.warn(`[Discord Chat:${tenantId}] !img guild failed:`, error);
        if (channelId) {
          await sendDiscordRouteReplyOrCollect(
            channelId,
            isImagePromptModerationError(error)
              ? 'That image request was blocked by this community’s content safety settings.'
              : 'Image generation failed. Try again in a moment.',
          );
        }
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'guild-image', error: 'image-failed' });
      }

      if (!result.images.length) {
        if (channelId) {
          await sendDiscordRouteReplyOrCollect(channelId, 'Image generation returned no image URL.');
        }
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'guild-image', error: 'empty-image' });
      }

      if (channelId) {
        for (const image of result.images) {
          const imageUrl = await maybeShortenUrl(image);
          await sendDiscordRouteReplyOrCollect(
            channelId,
            result.originalPrompt || prompt,
            getBotName(tenantId),
            'Image Generated',
            imageUrl,
          );
        }
      }
      return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'guild-image', images: result.images });
    }

    // Bridge to Twitch if enabled, dispatch is true, message is from the configured bridge channel,
    // and the bot is NOT mentioned (bot conversations stay in Discord)
    if (!isPrivateDiscordLane && message.trim().startsWith('!')) {
      const dispatchResult = await handleDiscordMessage({
        content: message,
        channelId,
        channel_id: channelId,
        guildId,
        guild_id: guildId,
        guild: normalized.guildName ? { name: normalized.guildName } : undefined,
        channel: normalized.channelName ? { name: normalized.channelName, type: normalized.channelType } : undefined,
        messageId: normalized.messageId,
        message_id: normalized.messageId,
        createdAt: normalized.createdAt,
        created_at: normalized.createdAt,
        isDM: false,
        author: {
          id: userId,
          username: normalized.username,
          globalName: userName,
          global_name: userName,
          bot: false,
        },
        mentions: data?.mentions,
        isAdmin: effectiveIsAdmin,
        isMod: effectiveIsMod,
        isOwner: effectiveIsOwner,
        memberPermissions: normalized.memberPermissions,
      }, tenantId, {
        skipPublicHistory: true,
        skipAiMentions: true,
      });

      if (dispatchResult.commandHandled) {
        return apiOk({ success: true, botResponded: false, commandHandled: true });
      }
    }

    if (dispatch && tenantId && channelId && !botMentioned) {
      try {
        const dcConfig = await readDiscordConfig(tenantId);
        const bridgeEnabled = dcConfig.discordBridgeEnabled !== false && dcConfig.logChannelId === channelId;

        if (bridgeEnabled) {
          // Don't bridge bot commands to Twitch
          if (!message.trim().match(/^!img/i)) {
            const { sendChatMessage } = require('@/services/twitch');
            const twitchMsg = `[Discord] ${userName}: ${message}`;
            await sendChatMessage(twitchMsg, 'bot', undefined, tenantId);
          }
        }
      } catch (e) {
        console.warn('[Discord Chat] Twitch bridge failed:', e);
      }
    }

    // A short-lived relay invitation may be answered with a bot mention or
    // simply "reply"/"yes" plus a message (or "no") in the delivery channel.
    if (!isDiscordBotAuthor(data) && channelId) {
      const replyBotTenantId = botMatch?.tenantId || tenantId || undefined;
      const replyBotName = botMatch?.botName || getBotName(replyBotTenantId);
      const replyLore = await readWorldLore();
      const replySpeaker = resolveDiscordRelaySpeaker({
        characters: Object.values(replyLore?.characters || {}),
        botName: replyBotName,
        tenantId: replyBotTenantId,
        trigger: botMatch?.trigger,
      });
      const relayReply = await handleBotRelayReply({
        sourcePlatform: 'discord',
        sourceChannelId: channelId,
        sourceContextTenantId: replyBotTenantId,
        sourceUserName: userName,
        sourceUserId: userId,
        speaker: replySpeaker,
        speakerTenantId: replyBotTenantId,
        message,
        botNames: [
          replyBotName,
          botMatch?.trigger || '',
          replySpeaker.currentName,
          ...(replySpeaker.aliases || []),
          ...(replySpeaker.previousNames || []),
        ],
      });

      if (relayReply.matched) {
        let replyText = '';
        if (relayReply.closed) {
          replyText = `Relay closed. I won't send anything back to ${relayReply.targetName || 'the original sender'}.`;
        } else if (relayReply.missingMessage) {
          replyText = 'Add your message after "reply" or "yes", or tell me "no" to close the relay.';
        } else if (relayReply.delivered) {
          replyText = `Your reply was sent back to ${relayReply.targetName || 'the original sender'} at the original location. They received the same reply options.`;
        } else if (botMentioned) {
          replyText = relayReply.error === 'no-pending-relay'
            ? 'There is no active relay for you in this channel. Relay invitations expire after 5 minutes.'
            : `I couldn't send that reply: ${relayReply.error || 'unknown relay error'}`;
        }

        if (replyText) {
          await sendDiscordRouteReplyOrCollect(
            channelId,
            replyText,
            replyBotName,
            'Message Relay',
          );
          return apiOk({
            success: true,
            botResponded: true,
            relayReply: true,
            relayDelivered: Boolean(relayReply.delivered),
            relayClosed: Boolean(relayReply.closed),
            replies: relayOnly ? collectedReplies : undefined,
          });
        }
      }
    }

    // If bot not mentioned, just bridge and return
    if (!botMentioned) {
      // Check if user has TTS enabled via !say — queue to standalone say system
      const botAuthor = isDiscordBotAuthor(data);
      const speakable = isSayTextSpeakable(message);
      const isCommand = message.trim().startsWith('!');
      let sayEnabled = false;
      let sayQueued = false;
      if (!botAuthor && speakable && !isCommand) {
        try {
          const sayUsers = await readSayUsers();
          sayEnabled = isSayEnabled(sayUsers, userId, channelId);
          if (sayEnabled) {
            const sayChannelKey = resolveSayStreamKey(undefined, 'discord', channelId);
            const spokenMessage = formatSaySpeechText(sayChannelKey, userName, message);
            fetch(`${getInternalAppUrl()}/api/say/queue`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tenantId: sayChannelKey, text: spokenMessage }),
            }).then(async (response) => {
              const result = await response.json().catch(() => null);
              logDiscordTrace(traceId, 'say-queue-result', {
                ok: response.ok && Boolean(result?.ok),
                status: response.status,
                tenantId: sayChannelKey,
                queued: result?.queued || 0,
                skipped: Boolean(result?.skipped),
                reason: result?.reason || result?.error || null,
              });
            }).catch((error) => {
              logDiscordTrace(traceId, 'say-queue-result', {
                ok: false,
                tenantId: sayChannelKey,
                error: error instanceof Error ? error.message : String(error),
              });
            });
            sayQueued = true;
          }
        } catch (error) {
          logDiscordTrace(traceId, 'say-state-error', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      logDiscordTrace(traceId, 'say-decision', {
        eligible: !botAuthor && speakable && !isCommand,
        botAuthor,
        speakable,
        isCommand,
        sayEnabled,
        queueRequested: sayQueued,
        userId: userId || null,
        channelId: channelId || null,
      });
      logDiscordTrace(traceId, 'complete', {
        botResponded: false,
        reason: 'bot-not-mentioned',
        replyCount: collectedReplies.length,
      });
      return apiOk({ success: true, botResponded: false });
    }

    // Generate AI response
    const botTenantId = botMatch?.tenantId;
    const botName = botMatch?.botName || getBotName(tenantId);
    const triggerIgnored = await isBotTriggerIgnored({
      tenantId: botTenantId || tenantId || undefined,
      botName,
      trigger: botMatch?.trigger,
    }, tenantId);
    logDiscordTrace(traceId, 'trigger-decision', {
      botName,
      botTenantId: botTenantId || null,
      guildTenantId: tenantId || null,
      trigger: botMatch?.trigger || null,
      ignored: triggerIgnored,
    });
    if (triggerIgnored) {
      console.log('[Discord Chat] Bot trigger ignored:', {
        tenantId: tenantId || null,
        botTenantId: botTenantId || null,
        botName,
      });
      logDiscordTrace(traceId, 'complete', {
        botResponded: false,
        reason: 'bot-trigger-ignored',
        botName,
      });
      return apiOk({ success: true, botResponded: false, ignored: true, botName });
    }
    console.log(`[Discord Chat] ${botName} mentioned by ${userName}, generating response for tenant ${botTenantId || 'global'}...`);

    const openCommand = await detectOpenBotCommandWithAi(message, botTenantId || tenantId || undefined);
    if (openCommand) {
      try {
        const openReply = await runOpenBotCommand(openCommand);
        if (channelId) {
          const structuredInput = {
            channelId,
            message: openReply,
            tenantId: botTenantId || tenantId || undefined,
            botName,
            responseType: 'Command Response',
            sourceMessageId: normalized.messageId,
            sourceMessage: message,
            sourceUser: userName,
            sourceUserAvatarUrl: userAvatar,
            isPrivate: false,
          };
          if (relayOnly) {
            const payload = await buildStructuredDiscordReplyPayload(structuredInput);
            collectReply({ content: payload.content, embeds: payload.embeds, username: payload.username });
          } else {
            await sendStructuredDiscordReply(structuredInput);
          }
        }
        logDiscordTrace(traceId, 'open-command', {
          command: openCommand,
          botName,
          tenantId: botTenantId || tenantId || null,
          delivered: Boolean(channelId),
        });
        return apiOk({
          success: true,
          botResponded: Boolean(channelId),
          response: openReply,
          botName,
          tenantId: botTenantId || tenantId || null,
          context: `open-${openCommand}`,
          replies: relayOnly ? collectedReplies : undefined,
        });
      } catch (error) {
        console.warn(`[Discord Chat:${botTenantId || tenantId || 'global'}] Open command ${openCommand} failed; falling back to AI:`, error);
      }
    }

    if (!isDiscordBotAuthor(data) || await getBotShareMode(botTenantId || tenantId || undefined) === 'on') {
      const lore = await readWorldLore();
      const characters = Object.values(lore?.characters || {});
      const relaySpeaker = resolveDiscordRelaySpeaker({
        characters,
        botName,
        tenantId: botTenantId || tenantId || undefined,
        trigger: botMatch?.trigger,
      });
      const relayRequest = await detectBotRelayRequestWithAi({
        message,
        speakerName: relaySpeaker.currentName,
        targets: characters.filter((character) => character.stableId !== relaySpeaker.stableId),
        tenantId: botTenantId || tenantId || undefined,
        platform: 'discord',
      });

      if (relayRequest.matched && relayRequest.relayMessage) {
        const humanDirectedRelay = !isDiscordBotAuthor(data);
        const deliverySpeaker = humanDirectedRelay
          ? await resolveHumanRelaySpeaker({
              sourcePlatform: 'discord',
              sourceUserName: userName,
              sourceUserId: userId,
            })
          : {
              character: relaySpeaker,
              tenantId: botTenantId || tenantId || undefined,
              usesCommunityBot: false,
            };
        console.log('[Discord Chat] Bot relay intent detected:', {
          source: relayRequest.source || 'unknown',
          commandBot: relaySpeaker.currentName,
          deliverySpeaker: deliverySpeaker.character.currentName,
          communityFallback: deliverySpeaker.usesCommunityBot,
          targetName: relayRequest.targetName || relayRequest.target?.currentName || null,
          messagePreview: relayRequest.relayMessage.slice(0, 120),
        });
        const resolvedRelayTarget = await resolveRelayTarget({
          namedTarget: relayRequest.targetName,
          structuredTarget: relayRequest.target,
          fallbackTenantId: botTenantId || tenantId || undefined,
        });
        if (!resolvedRelayTarget) {
          if (relayRequest.targetName && isDirectHumanRelayTarget(relayRequest.targetName)) {
            const directMessage = buildDirectHumanRelayMessage({
              targetName: relayRequest.targetName,
              sourceUserName: userName,
              relayMessage: relayRequest.relayMessage,
            });
            console.log('[Discord Chat] Bot relay delivered directly to human target in current Discord channel:', {
              targetName: relayRequest.targetName,
              channelId,
              source: relayRequest.source || 'unknown',
            });
            if (channelId) {
              await sendDiscordRouteReplyOrCollect(
                channelId,
                directMessage,
                deliverySpeaker.character.currentName,
                'Message Relay',
              );
            }
            return apiOk({ success: true, botResponded: Boolean(channelId), relayDelivered: true, relayMode: 'direct-human', replies: relayOnly ? collectedReplies : undefined });
          }
          console.warn('[Discord Chat] Bot relay target unresolved:', {
            targetName: relayRequest.targetName || relayRequest.target?.currentName || null,
            triggerMessage: message,
          });
          if (channelId) {
            await sendDiscordRouteReplyOrCollect(channelId, `@${userName}, I couldn't figure out which bot or streamer to pass that to.`);
          }
          return apiOk({ success: true, botResponded: Boolean(channelId), relayDelivered: false, relayError: 'target-unresolved', replies: relayOnly ? collectedReplies : undefined });
        }

        const ackReply = `I'll pass that along to ${resolvedRelayTarget.character.currentName} through ${deliverySpeaker.character.currentName}. They'll get instructions for replying back here.`;
        if (channelId) {
          const structuredInput = {
            channelId,
            message: ackReply,
            tenantId: deliverySpeaker.tenantId,
            botName: deliverySpeaker.character.currentName,
            responseType: 'Message Relay',
            sourceMessageId: normalized.messageId,
            sourceMessage: message,
            sourceUser: userName,
            sourceUserAvatarUrl: userAvatar,
            isPrivate: isDirectMessage,
          };
          if (relayOnly) {
            const payload = await buildStructuredDiscordReplyPayload(structuredInput);
            collectReply({ content: payload.content, embeds: payload.embeds, username: payload.username });
          } else {
            await sendStructuredDiscordReply(structuredInput);
          }
        }

        const relayResult = await deliverBotRelay({
          sourcePlatform: 'discord',
          sourceChannelId: channelId,
          sourceContextTenantId: tenantId || undefined,
          sourceUserName: userName,
          sourceUserId: userId,
          triggerMessage: message,
          speaker: deliverySpeaker.character,
          speakerTenantId: deliverySpeaker.tenantId,
          target: resolvedRelayTarget.character,
          targetTenantId: resolvedRelayTarget.tenantId,
          relayMessage: relayRequest.relayMessage,
          humanDirected: humanDirectedRelay,
        });

        if (!relayResult.delivered && relayResult.error && channelId) {
          await sendDiscordRouteReplyOrCollect(channelId, `@${userName}, I couldn't reach ${resolvedRelayTarget.character.currentName}: ${relayResult.error}`);
        }

        return apiOk({ success: true, botResponded: true, relayDelivered: relayResult.delivered, relayMode: relayResult.mode || null, replies: relayOnly ? collectedReplies : undefined });
      }

    }

    const botInteractionDecision = await decideBotInteraction({
      message,
      currentBotName: botName,
      tenantId: botTenantId || tenantId || undefined,
      platform: 'discord',
    });

    const relayRequest = botInteractionDecision?.shouldRespond
      ? detectBotRelayRequest({
          message,
          speakerName: botInteractionDecision.speaker.currentName,
          targets: botInteractionDecision.targets,
        })
      : { matched: false as const };
    if (relayRequest.matched && relayRequest.relayMessage && botInteractionDecision?.shouldRespond) {
      const resolvedRelayTarget = await resolveRelayTarget({
        namedTarget: relayRequest.targetName,
        structuredTarget: relayRequest.target,
        fallbackTenantId: botTenantId || tenantId || undefined,
      });
      if (resolvedRelayTarget) {
        const ackReply = `I'll pass that along to ${resolvedRelayTarget.character.currentName}.`;
        if (channelId) {
          const structuredInput = {
            channelId,
            message: ackReply,
            tenantId: botTenantId || tenantId || undefined,
            botName,
            responseType: 'Message Relay',
            sourceMessageId: normalized.messageId,
            sourceMessage: message,
            sourceUser: userName,
            sourceUserAvatarUrl: userAvatar,
            isPrivate: isDirectMessage,
          };
          if (relayOnly) {
            const payload = await buildStructuredDiscordReplyPayload(structuredInput);
            collectReply({ content: payload.content, embeds: payload.embeds, username: payload.username });
          } else {
            await sendStructuredDiscordReply(structuredInput);
          }
        }

        const relayResult = await deliverBotRelay({
          sourcePlatform: 'discord',
          sourceUserName: userName,
          triggerMessage: message,
          speaker: botInteractionDecision.speaker,
          speakerTenantId: botTenantId || tenantId || undefined,
          target: resolvedRelayTarget.character,
          targetTenantId: resolvedRelayTarget.tenantId,
          relayMessage: relayRequest.relayMessage,
          humanDirected: !isDiscordBotAuthor(data),
        });

        if (!relayResult.delivered && relayResult.error && channelId) {
          await sendDiscordRouteReplyOrCollect(channelId, `@${userName}, I couldn't reach ${resolvedRelayTarget.character.currentName}: ${relayResult.error}`);
        }

        return apiOk({ success: true, botResponded: true, relayDelivered: relayResult.delivered, relayMode: relayResult.mode || null, replies: relayOnly ? collectedReplies : undefined });
      }
    }

    const aiRes = await fetch(`${getInternalAppUrl()}/api/ai/chat-with-memory`, {
      method: 'POST',
      headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username: normalized.username || userName,
        userId,
        displayName: userName,
        guildId,
        guildName: normalized.guildName,
        channelId,
        channelName: normalized.channelName,
        channelType: normalized.channelType,
        messageId: normalized.messageId,
        createdAt: normalized.createdAt,
        isDirectMessage,
        message: botInteractionDecision?.shouldRespond ? botInteractionDecision.promptInstruction : message,
        tenantId: botTenantId || tenantId || undefined,
        context: 'discord',
      }),
    });

    if (!aiRes.ok) {
      console.error('[Discord Chat] AI response failed:', aiRes.status);
      logDiscordTrace(traceId, 'ai-result', {
        ok: false,
        status: aiRes.status,
        botName,
      });
      return apiOk({ success: true, botResponded: false, error: 'ai-failed' });
    }

    const aiData = await aiRes.json();
    const aiReply = aiData.response || aiData.data?.response || '';

    if (!aiReply) {
      logDiscordTrace(traceId, 'ai-result', {
        ok: false,
        reason: 'empty-response',
        botName,
      });
      return apiOk({ success: true, botResponded: false, error: 'empty-response' });
    }
    logDiscordTrace(traceId, 'ai-result', {
      ok: true,
      botName,
      responseLength: aiReply.length,
    });

    // Send response to Discord and queue the same reply for the persistent TTS overlay.
    let discordReplySent = false;
    if (channelId) {
      try {
        const structuredInput = {
          channelId,
          message: aiReply,
          tenantId: botTenantId || tenantId || undefined,
          botName,
          responseType: 'AI Answer',
          sourceMessageId: normalized.messageId,
          sourceMessage: message,
          sourceUser: userName,
          sourceUserAvatarUrl: userAvatar,
          isPrivate: isDirectMessage,
        };
        let sentReply: Awaited<ReturnType<typeof sendStructuredDiscordReply>> | null = null;
        if (relayOnly) {
          const payload = await buildStructuredDiscordReplyPayload(structuredInput);
          collectReply({ content: payload.content, embeds: payload.embeds, username: payload.username });
        } else {
          sentReply = await sendStructuredDiscordReply(structuredInput);
          const ttsResult = await queueTtsOverlay(aiReply, botTenantId || tenantId || undefined);
          if (!ttsResult.ok) console.warn('[Discord Chat] TTS overlay queue failed:', ttsResult.error);
        }
        discordReplySent = true;
        console.log(`[Discord Chat] Bot responded via webhook in channel ${channelId}`);
        logDiscordTrace(traceId, relayOnly ? 'reply-collected' : 'reply-delivered', {
          botName,
          channelId,
          replyMode: relayOnly ? 'collect' : 'direct',
          replyCount: relayOnly ? collectedReplies.length : 1,
        });
        const interactionTenantId = botTenantId || tenantId;
        if (!relayOnly && botInteractionDecision?.shouldRespond && interactionTenantId) {
          await appendBotInteraction({
            platform: 'discord',
            tenantId: interactionTenantId,
            channelId,
            sourceUser: userName,
            speakerBotId: botInteractionDecision.speaker.stableId,
            speakerBotName: botInteractionDecision.speaker.currentName,
            targetBotIds: botInteractionDecision.targets.map((target) => target.stableId),
            targetBotNames: botInteractionDecision.targets.map((target) => target.currentName),
            triggerMessage: message,
            responseMessage: aiReply,
          }).catch(() => {});
        }

        if (!relayOnly) {
          const followUpDecision = botInteractionDecision?.shouldRespond
            ? botInteractionDecision
            : await decideReplyMentionInteraction({
              speakerBotName: botName,
              speakerTenantId: botTenantId || tenantId || undefined,
              triggerMessage: message,
              speakerReply: aiReply,
            });
          const followUpReplyIds = await sendCrossBotTargetReplies({
            channelId,
            userName,
            userAvatar,
            triggerMessage: message,
            speakerReply: aiReply,
            decision: followUpDecision,
            tenantId: botTenantId || tenantId || undefined,
            maxReplies: randomCrossBotReplyBudget(),
          }).catch((error) => console.error('[Discord Chat] Cross-bot target reply failed:', error));
          await recordDiscordMessageCleanup({
            tenantId: botTenantId || tenantId || undefined,
            channelId,
            triggerMessageId: normalized.messageId,
            triggerMessage: message,
            replyMessageIds: [
              sentReply?.messageId || '',
              ...(followUpReplyIds || []),
            ],
            replyMessages: [
              aiReply,
            ],
            sourceUser: userName,
            botName,
          }).catch((error) => console.warn('[Discord Chat] Cleanup record failed:', error));
        }
      } catch (webhookError) {
        console.error('[Discord Chat] Webhook send failed:', webhookError);
      }
    } else {
      console.warn('[Discord Chat] Cannot send bot response: missing channelId');
    }

    logDiscordTrace(traceId, 'complete', {
      botResponded: discordReplySent,
      botName,
      tenantId: botTenantId || tenantId || null,
      replyMode: relayOnly ? 'collect' : 'direct',
      replyCount: relayOnly ? collectedReplies.length : (discordReplySent ? 1 : 0),
    });
    return apiOk({
      success: true,
      botResponded: discordReplySent,
      response: aiReply,
      botName,
      tenantId: botTenantId || tenantId || null,
      replies: relayOnly ? collectedReplies : undefined,
    });
  } catch (error) {
    console.error('[Discord Chat] Error:', error);
    return apiOk({ success: false, error: 'internal' });
  }
}

type BotMatch = {
  tenantId?: string;
  botName: string;
  trigger: string;
  index: number;
};

function splitAliases(value: string | undefined) {
  return String(value || '')
    .toLowerCase()
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean);
}

function characterTriggers(character: WorldLoreCharacter): string[] {
  return Array.from(new Set([
    character.currentName,
    ...(character.aliases || []),
    ...(character.previousNames || []),
  ].filter(Boolean)));
}

function triggerMatches(message: string, trigger: string) {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(message);
}

function triggerIndex(message: string, trigger: string) {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').exec(message);
  return match?.index ?? -1;
}

export async function resolveMentionedBot(messageLower: string, _guildTenantId?: string): Promise<BotMatch | null> {
  const candidates: BotMatch[] = [];
  const addCandidate = (tenantId: string | undefined) => {
    const botName = getBotName(tenantId);
    const configAliases = splitAliases(readUserConfigSync(tenantId).AI_BOT_ALIASES);
    const settingAliases = splitAliases(getBotAliases(tenantId));
    const triggers = Array.from(new Set([
      botName.toLowerCase(),
      `hey ${botName.toLowerCase()}`,
      ...configAliases,
      ...settingAliases,
    ].filter(Boolean)));

    for (const trigger of triggers) {
      const index = triggerIndex(messageLower, trigger);
      if (index >= 0) {
        candidates.push({ tenantId, botName, trigger, index });
      }
    }
  };

  for (const tenantId of await listTenants()) {
    addCandidate(tenantId);
    await addLoreCandidate(messageLower, candidates, tenantId);
  }

  candidates.sort((a, b) => a.index - b.index || b.trigger.length - a.trigger.length);
  return candidates[0] || null;
}

async function addLoreCandidate(messageLower: string, candidates: BotMatch[], tenantId?: string) {
  if (!tenantId) return;
  const lore = await readWorldLore();
  const characters = Object.values(lore?.characters || {});
  const tenantCharacters = characters.filter((character) => character.stableId.startsWith(`${tenantId}:`) || character.stableId.startsWith('unknown:'));

  for (const character of tenantCharacters) {
    const triggers = Array.from(new Set([
      character.currentName,
      ...(character.aliases || []),
      ...(character.previousNames || []),
    ].filter(Boolean).map((value) => value.toLowerCase())));

    for (const trigger of triggers) {
      const index = triggerIndex(messageLower, trigger);
      if (index >= 0) {
        candidates.push({ tenantId, botName: character.currentName, trigger, index });
      }
    }
  }
}

async function getDiscordLogChannelId(tenantId?: string): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const config = await readDiscordConfig(tenantId);
    return config.logChannelId || null;
  } catch {
    return null;
  }
}

async function buildDiscordListenLinks(channelId: string): Promise<Array<{ tenantId: string; label: string; url: string }>> {
  const sayUsers = await readSayUsers();
  if (!hasSayEnabledInChannel(sayUsers, channelId)) return [];

  const links: Array<{ tenantId: string; label: string; url: string }> = [];
  const seen = new Set<string>();

  const addLink = (tenantId: string, label: string, url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ tenantId, label, url });
  };

  const channelKey = resolveSayStreamKey(undefined, 'discord', channelId);
  addLink(channelKey, 'This Discord channel', buildSayPlayerUrl(undefined, 'discord', channelId));
  return links;
}

async function sendDiscordBotEmbedReply(
  channelId: string,
  message: string,
  tenantId?: string,
  source?: {
    sourceMessageId?: string;
    sourceMessage?: string;
    sourceUser?: string;
    sourceUserAvatarUrl?: string;
    responseType?: string;
    gifEnabled?: boolean;
    ttsEnabled?: boolean;
    adultMode?: boolean;
  },
) {
  const botName = getBotName(tenantId);
  await sendStructuredDiscordReply({
    channelId,
    message,
    tenantId,
    botName,
    ...source,
    isPrivate: true,
  });
}

export async function resolveDiscordAuthorTenant(userId?: string, username?: string): Promise<string | undefined> {
  const normalizedUserId = String(userId || '').trim();
  const normalizedUsername = String(username || '').trim().toLowerCase();
  if (!normalizedUserId && !normalizedUsername) return undefined;

  try {
    const tenantIds = await listTenants();
    if (normalizedUserId && tenantIds.includes(normalizedUserId)) return normalizedUserId;

    for (const id of tenantIds) {
      try {
        const config = await readDiscordConfig(id);
        if (normalizedUserId && String(config.discordUserId || '').trim() === normalizedUserId) return id;
        if (normalizedUsername && String(config.discordUsername || '').trim().toLowerCase() === normalizedUsername) return id;
      } catch {}
    }
  } catch {}

  return undefined;
}

/**
 * Resolve a Discord lane to a tenant. A guild is not tenant ownership here:
 * most tenants share the same Discord server, so public guild matches only
 * resolve when exactly one tenant has that guild configured.
 */
async function resolveGuildTenant(guildId: string, channelId?: string): Promise<string | undefined> {
  try {
    const tenantIds = await listTenants();
    if (!tenantIds.length) return undefined;

    if (!guildId) {
      if (channelId) {
        for (const id of tenantIds) {
          try {
            const config = await readDiscordConfig(id);
            if (config.dmChannelId === channelId) return id;
          } catch {}
        }
      }

      const ownerTenantId = (process.env.DISCORD_DM_OWNER_TENANT_ID || getAdminTwitchId()).trim();
      if (ownerTenantId && tenantIds.includes(ownerTenantId)) return ownerTenantId;
      if (tenantIds.length === 1) return tenantIds[0];
      return undefined;
    }

    const matches: string[] = [];
    for (const id of tenantIds) {
      try {
        const config = await readDiscordConfig(id);
        if (config.guildId === guildId) matches.push(id);
      } catch {}
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return undefined;
  } catch {}

  // If the guild is unknown, only fall back automatically in strict single-tenant mode.
  try {
    const tenants = await listTenants();
    if (tenants.length === 1) return tenants[0];
  } catch {}
  return undefined;
}

async function maybeShortenUrl(url: string): Promise<string> {
  const trimmed = String(url || '').trim();
  if (!trimmed) return trimmed;
  if (trimmed.length <= 1900) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const tinyRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(trimmed)}`);
    if (!tinyRes.ok) return trimmed;
    const tiny = (await tinyRes.text()).trim();
    return /^https?:\/\//i.test(tiny) ? tiny : trimmed;
  } catch {
    return trimmed;
  }
}

async function decideReplyMentionInteraction(input: {
  speakerBotName: string;
  speakerTenantId?: string;
  triggerMessage: string;
  speakerReply: string;
}): Promise<Awaited<ReturnType<typeof decideBotInteraction>> | null> {
  const mode = await getBotShareMode(input.speakerTenantId);
  if (mode !== 'on') {
    console.log('[Discord Chat] Cross-bot follow-up skipped: botshare is off', {
      speakerBotName: input.speakerBotName,
      speakerTenantId: input.speakerTenantId || null,
    });
    return null;
  }

  const lore = await readWorldLore();
  const characters = Object.values(lore?.characters || {});
  if (!characters.length) {
    console.log('[Discord Chat] Cross-bot follow-up skipped: no world lore characters loaded');
    return null;
  }

  const speaker = findLoreCharacterByName(characters, input.speakerBotName)
    || (input.speakerTenantId ? characters.find((character) => character.stableId.startsWith(`${input.speakerTenantId}:`)) : undefined)
    || {
      stableId: input.speakerTenantId ? `${input.speakerTenantId}:${input.speakerBotName.toLowerCase()}` : `unknown:${input.speakerBotName.toLowerCase()}`,
      currentName: input.speakerBotName,
    };

  const combinedLower = `${input.triggerMessage}\n${input.speakerReply}`.toLowerCase();
  const directTargets = characters.filter((character) =>
    character.stableId !== speaker.stableId
    && characterTriggers(character).some((trigger) => triggerMatches(combinedLower, trigger.toLowerCase()))
  );
  const relationshipTargets = inferDiscordRelationshipTargets(combinedLower, speaker, characters, lore?.relationships || {});
  const candidates = uniqueDiscordCharacters([...directTargets, ...relationshipTargets]);
  const targets: WorldLoreCharacter[] = [];
  for (const target of candidates) {
    if (!(await isBotTriggerIgnored({
      tenantId: tenantIdFromStableId(target.stableId),
      stableId: target.stableId,
      botName: target.currentName,
    }, input.speakerTenantId))) {
      targets.push(target);
    }
  }

  if (!targets.length) {
    console.log('[Discord Chat] Cross-bot follow-up skipped: no target bot found', {
      speakerBotName: input.speakerBotName,
      triggerPreview: input.triggerMessage.slice(0, 120),
      replyPreview: input.speakerReply.slice(0, 120),
    });
    return null;
  }

  console.log('[Discord Chat] Cross-bot follow-up decision:', {
    speaker: speaker.currentName,
    targets: targets.map((target) => target.currentName),
  });

  return {
    shouldRespond: true,
    reason: 'bot-reply-mentioned-bot',
    speaker,
    targets,
    promptInstruction: input.speakerReply,
  };
}

async function sendCrossBotTargetReplies(input: {
  channelId: string;
  userName: string;
  userAvatar?: string;
  triggerMessage: string;
  speakerReply: string;
  decision: Awaited<ReturnType<typeof decideBotInteraction>>;
  tenantId?: string;
  maxReplies: number;
}): Promise<string[]> {
  const decision = input.decision;
  if (!decision?.shouldRespond || !decision.targets.length) {
    console.log('[Discord Chat] Cross-bot follow-up skipped: no decision');
    return [];
  }
  const maxReplies = Math.max(0, Math.min(3, Math.floor(input.maxReplies)));
  if (maxReplies <= 0) {
    console.log('[Discord Chat] Cross-bot follow-up skipped: reply budget rolled 1');
    return [];
  }

  const replyIds: string[] = [];
  let previousSpeaker = decision.speaker;
  let previousReply = input.speakerReply;
  let currentTarget = decision.targets[0];

  for (let index = 0; index < maxReplies; index++) {
    const target = currentTarget;
    const targetTenantId = await resolveDiscordBotTenantId(target.currentName, tenantIdFromStableId(target.stableId));
    const targetPersonality = [
      `You are ${target.currentName}.`,
      target.archetype ? `Archetype: ${target.archetype}.` : '',
      target.summary || '',
      target.personalityNotes?.length ? target.personalityNotes.join(' ') : '',
      'Stay in this bot identity for this single Discord follow-up.',
    ].filter(Boolean).join('\n');
    const prompt = [
      `Cross-bot follow-up on Discord.`,
      `You are ${target.currentName}.`,
      target.summary ? `Your lore: ${target.summary}` : '',
      target.personalityNotes?.length ? `Personality notes: ${target.personalityNotes.join(' ')}` : '',
      `${previousSpeaker.currentName} replied: "${previousReply}"`,
      `${input.userName} originally asked: "${input.triggerMessage}"`,
      index < maxReplies - 1
        ? 'Answer as yourself in 1 short sentence and leave a natural opening for the other bot to respond. Do not impersonate the other bot.'
        : 'Answer as yourself in 1-2 short sentences and wrap up naturally. If this asks about a real streamer schedule and you do not know, say you are not sure and point them to the streamer or channel info. Do not impersonate the other bot.',
    ].filter(Boolean).join('\n');

    const aiRes = await fetch(`${getInternalAppUrl()}/api/ai/chat-with-memory`, {
      method: 'POST',
      headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username: input.userName,
        userId: undefined,
        displayName: input.userName,
        channelId: input.channelId,
        message: prompt,
        personality: targetPersonality,
        responseName: target.currentName,
        tenantId: targetTenantId,
        context: 'discord-cross-bot',
      }),
    });

    if (!aiRes.ok) {
      console.error('[Discord Chat] Cross-bot target AI failed:', aiRes.status, await aiRes.text().catch(() => ''));
      break;
    }

    const data = await aiRes.json();
    const reply = data.response || data.data?.response || '';
    if (!reply.trim()) {
      console.log('[Discord Chat] Cross-bot target AI returned empty response', {
        target: target.currentName,
      });
      break;
    }

    const sentReply = await sendStructuredDiscordReply({
      channelId: input.channelId,
      message: reply,
      tenantId: targetTenantId,
      botName: target.currentName,
      responseType: 'AI Follow-up',
      sourceMessage: input.triggerMessage,
      sourceUser: input.userName,
      sourceUserAvatarUrl: input.userAvatar,
    });
    const ttsResult = await queueTtsOverlay(reply, targetTenantId);
    if (!ttsResult.ok) console.warn('[Discord Chat] Cross-bot TTS overlay queue failed:', ttsResult.error);
    console.log('[Discord Chat] Cross-bot target responded via webhook:', {
      target: target.currentName,
      channelId: input.channelId,
    });
    if (targetTenantId) {
      await appendBotInteraction({
        platform: 'discord',
        tenantId: targetTenantId,
        channelId: input.channelId,
        sourceUser: input.userName,
        speakerBotId: target.stableId,
        speakerBotName: target.currentName,
        targetBotIds: [previousSpeaker.stableId],
        targetBotNames: [previousSpeaker.currentName],
        triggerMessage: input.triggerMessage,
        responseMessage: reply,
      }).catch(() => {});
    }
    if (sentReply.messageId) replyIds.push(sentReply.messageId);

    currentTarget = previousSpeaker as WorldLoreCharacter;
    previousSpeaker = target;
    previousReply = reply;
  }

  return replyIds;
}

function randomCrossBotReplyBudget(): number {
  return 1 + Math.floor(Math.random() * 4);
}

function tenantIdFromStableId(stableId: string): string | undefined {
  const [prefix] = stableId.split(':');
  if (!prefix || prefix === 'unknown' || prefix === 'discordUserId' || prefix === 'twitchUserId') return undefined;
  return prefix;
}

function findLoreCharacterByName(characters: WorldLoreCharacter[], name: string): WorldLoreCharacter | undefined {
  const normalized = name.toLowerCase();
  return characters.find((character) =>
    characterTriggers(character).some((trigger) => trigger.toLowerCase() === normalized)
  );
}

function resolveDiscordRelaySpeaker(input: {
  characters: WorldLoreCharacter[];
  botName: string;
  tenantId?: string;
  trigger?: string;
}): WorldLoreCharacter {
  const trigger = String(input.trigger || '').replace(/^hey\s+/i, '').trim();
  const direct = findLoreCharacterByName(input.characters, input.botName)
    || (trigger ? findLoreCharacterByName(input.characters, trigger) : undefined)
    || (input.tenantId ? input.characters.find((character) => character.stableId.startsWith(`${input.tenantId}:`)) : undefined);
  if (direct) return direct;

  const normalizedName = input.botName.toLowerCase().replace(/^@/, '').trim() || 'bot';
  return {
    stableId: input.tenantId ? `${input.tenantId}:${normalizedName}` : `unknown:${normalizedName}`,
    currentName: input.botName || 'Bot',
    aliases: trigger && trigger.toLowerCase() !== normalizedName ? [trigger] : [],
  };
}

function uniqueDiscordCharacters(characters: WorldLoreCharacter[]): WorldLoreCharacter[] {
  const seen = new Set<string>();
  const unique: WorldLoreCharacter[] = [];
  for (const character of characters) {
    if (seen.has(character.stableId)) continue;
    seen.add(character.stableId);
    unique.push(character);
  }
  return unique;
}

function inferDiscordRelationshipTargets(
  messageLower: string,
  speaker: WorldLoreCharacter,
  characters: WorldLoreCharacter[],
  relationships: Record<string, { characterIds: string[]; label: string; summary: string }>
): WorldLoreCharacter[] {
  const relationshipIds = speaker.relationshipIds || [];
  if (!relationshipIds.length) return [];

  const targets: WorldLoreCharacter[] = [];
  for (const relationshipId of relationshipIds) {
    const relationship = relationships[relationshipId];
    if (!relationship || !relationship.characterIds.includes(speaker.stableId)) continue;
    if (!discordRelationshipPhraseMatches(messageLower, relationship.label, relationship.summary)) continue;

    for (const characterId of relationship.characterIds) {
      if (characterId === speaker.stableId) continue;
      const target = characters.find((character) => character.stableId === characterId);
      if (target) targets.push(target);
    }
  }

  return targets;
}

function discordRelationshipPhraseMatches(messageLower: string, label: string, summary: string): boolean {
  const relationshipText = `${label} ${summary}`.toLowerCase();
  const phraseGroups = [
    ['sister', 'sisters', 'sibling', 'siblings'],
    ['brother', 'brothers', 'sibling', 'siblings'],
    ['rival', 'rivals'],
    ['teacher', 'professor', 'dad'],
    ['soft spot', 'favorite'],
    ['opposite', 'opposites'],
  ];

  return phraseGroups.some((phrases) =>
    phrases.some((phrase) => relationshipText.includes(phrase))
    && phrases.some((phrase) => messageLower.includes(phrase))
  );
}
