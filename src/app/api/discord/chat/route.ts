import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { getBotAliases, getBotName } from '@/lib/bot-settings-store';
import { sendWebhookMessage } from '@/services/discord-webhooks';
import { readUserConfigSync } from '@/lib/user-config';
import { getAdminTwitchId, listTenants, tenantPath } from '@/lib/tenant';
import { appendBotInteraction, decideBotInteraction, getBotShareMode, toggleBotShareMode } from '@/lib/bot-interactions-store';
import { readWorldLore, type WorldLoreCharacter } from '@/lib/world-lore-store';
import { deleteMessage, sendDiscordMessage as sendDiscordBotMessage } from '@/services/discord-local';
import { promises as fs } from 'fs';
import { getGenMode, setGenMode, toggleGenMode } from '@/lib/gen-mode-store';
import { readGenerationSettings } from '@/lib/gen-settings-store';
import { getConfiguredAppUrl, getInternalAppUrl } from '@/lib/runtime-origin';
import { buildDiscordBotEmbed, getDiscordBotProfileAvatarUrl, getDiscordBotWebhookIdentity, resolveDiscordBotTenantId } from '@/services/discord-branding';
import { getAvatarUrlForTenant } from '@/services/discord-webhook-avatar';
import { sendStructuredDiscordReply } from '@/services/discord-structured-replies';
import { isBotTriggerIgnored, toggleBotTriggerIgnoreAll, toggleIgnoredBotTrigger } from '@/lib/bot-trigger-ignore-store';
import { getDiscordMessageCleanupDeleteAt, processDueDiscordMessageCleanups, recordDiscordMessageCleanup } from '@/services/discord-message-cleanup';
import { appendPublicChatMessages } from '@/lib/public-chat-store';
import { buildDirectHumanRelayMessage, deliverBotRelay, handleDiscordMessage, isDirectHumanRelayTarget, resolveRelayTarget } from '@/services/chat-dispatcher';
import { markDmMessageHandled } from '@/services/discord-dm-sweep-state';
import { registerHandledDiscordMessage } from '@/services/discord-message-dedupe';
import { hasDiscordModAccess } from '@/services/discord-permissions';
import { checkDiscordStreamHubAdminAccess } from '@/services/discord-stream-hub';
import { detectBotRelayRequest, detectBotRelayRequestWithAi } from '@/services/bot-relay';
import { recordDiscordLastSeen } from '@/services/discord-last-seen';
import {
  beginPendingMtSupportRequest,
  consumePendingMtSupportRequest,
  detectMtFixItIntent,
  getMtSupportPrompt,
  submitMtSupportReport,
} from '@/services/mt-support-report';
import { runImageCommand } from '@/services/image-command';
import { queueTtsOverlay } from '@/services/tts-overlay-queue';

const DISCORD_DM_IMAGE_COMMANDS_ENABLED = process.env.DISCORD_DM_IMAGE_COMMANDS_ENABLED === 'true' || process.env.NODE_ENV !== 'production';
const VERBOSE_LOGS = process.env.STREAMWEAVER_VERBOSE_LOGS === 'true';

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
      body = JSON.parse(raw.replace(/[\x00-\x1F\x7F]/g, ''));
    } catch (error) {
      console.error('[Discord Chat] Invalid JSON payload:', error);
      return apiOk({ success: false, error: 'invalid-json' });
    }

    const normalized = normalizeDiscordPayload(body);
    const data = normalized.raw;
    const userId = normalized.userId;
    const guildId = normalized.guildId;
    const userName = normalized.displayName || normalized.username;
    const userAvatar = normalized.avatarUrl;
    const message = normalized.message;
    const channelId = normalized.channelId;
    const dispatch = normalized.dispatch;
    const isDirectMessage = normalized.isDirectMessage;
    const relayOnly =
      request.headers.get('x-discord-reply-mode') === 'collect' ||
      request.headers.get('x-chat-origin') === 'dsh-fanout';
    const collectedReplies: Array<Record<string, unknown>> = [];
    processDueDiscordMessageCleanups().catch((error) => console.warn('[Discord Chat] Cleanup sweep failed:', error));

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

    const sendDiscordRouteReplyOrCollect = async (replyChannelId: string, replyMessage: string, username = 'StreamWeaver') => {
      if (!replyChannelId) return;
      if (relayOnly) {
        collectReply({ content: replyMessage, username });
        return;
      }
      if (message.trim().startsWith('!')) {
        await sendStructuredDiscordReply({
          channelId: replyChannelId,
          message: replyMessage,
          tenantId,
          rotateSpeaker: true,
          sourceMessageId: normalized.messageId,
          sourceMessage: message,
          sourceUser: userName,
        });
        return;
      }
      await sendDiscordRouteReply(replyChannelId, replyMessage, username);
    };

    if (!isDirectMessage) {
      const isFirstSeen = registerHandledDiscordMessage({
        messageId: normalized.messageId,
        channelId,
        userId,
        username: normalized.username,
        content: message,
        createdAt: normalized.createdAt,
      });
      if (!isFirstSeen) {
        const trimmedMessage = String(message || '').trim();
        const commandLikeMessage = trimmedMessage.startsWith('!') || detectMtFixItIntent(trimmedMessage).matched;
        console.log('[Discord Chat] Skipping duplicate public message:', {
          messageId: normalized.messageId || null,
          channelId: channelId || null,
          commandLikeMessage,
        });
        if (!commandLikeMessage) {
          return apiOk({ success: true, botResponded: false, duplicate: true });
        }
      }
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
    const dshAccess = await checkDiscordStreamHubAdminAccess({ guildId, userId });
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

    // Resolve which tenant this guild belongs to (or auto-assign on first message)
    let tenantId = normalized.tenantId || await resolveGuildTenant(guildId);

    if (!isDirectMessage) {
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
          channelId,
          description: mtFixItIntent.description,
          triggerMessage: message,
        });
        await sendDiscordRouteReplyOrCollect(
          channelId,
          result.ok
            ? `@${userName}, support report sent to Mtman1987.`
            : `@${userName}, I could not send the support report: ${result.error || 'unknown error'}`,
        );
        return apiOk({ success: true, botResponded: true, supportReportSent: result.ok, replies: relayOnly ? collectedReplies : undefined });
      }

      if (!message.trim().startsWith('!') && consumePendingMtSupportRequest({
        platform: 'discord',
        tenantId,
        username: userName,
        channelId,
      })) {
        const result = await submitMtSupportReport({
          platform: 'discord',
          tenantId,
          username: userName,
          channelId,
          description: message,
          triggerMessage: '!mtfixit',
        });
        await sendDiscordRouteReplyOrCollect(
          channelId,
          result.ok
            ? `@${userName}, support report sent to Mtman1987.`
            : `@${userName}, I could not send the support report: ${result.error || 'unknown error'}`,
        );
        return apiOk({ success: true, botResponded: true, supportReportSent: result.ok, replies: relayOnly ? collectedReplies : undefined });
      }
    }

    if (!isDirectMessage) {
      appendPublicChatMessages([{
        type: 'user',
        username: userName,
        message,
        timestamp: normalized.createdAt || new Date().toISOString(),
      }], 300, tenantId).catch((error) => {
        console.warn('[Discord Chat] Failed to append public chat history:', error);
      });
    }

    // Auto-save guildId to the tenant's discord-channels.json if not set yet
    if (!tenantId && guildId) {
      // Can't auto-assign without knowing which tenant — skip
    } else if (tenantId && guildId) {
      // Ensure guildId is persisted in their config
      try {
        const dcPath = tenantPath(tenantId, 'tokens/discord-channels.json');
        let dcConfig: Record<string, any> = {};
        try { dcConfig = JSON.parse(await fs.readFile(dcPath, 'utf-8')); } catch {}
        if (!dcConfig.guildId) {
          dcConfig.guildId = guildId;
          await fs.mkdir(dcPath.replace(/[\/\\][^\/\\]+$/, ''), { recursive: true });
          await fs.writeFile(dcPath, JSON.stringify(dcConfig, null, 2));
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

    const botMatch = await resolveMentionedBot(msgLower, tenantId);
    const botMentioned = Boolean(botMatch);
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

    if (isDirectMessage) {
      if (!tenantId) {
        return apiOk({ success: true, botResponded: false, error: 'tenant-not-found' });
      }
      const markHandled = () => markDmMessageHandled(tenantId!, normalized.messageId);

      const imgMatch = message.trim().match(/^!img(?:\s+(.+))?$/i);
      const genModeMatch = message.trim().match(/^!genmode(?:\s+(eden|seaart|perchance|pollinations|status))?$/i);
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
        if (channelId) await sendDiscordBotMessage(channelId, `Generation mode: ${mode.toUpperCase()}`);
        await markHandled();
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-genmode', mode });
      }
      if (DISCORD_DM_IMAGE_COMMANDS_ENABLED && imgMatch) {
        const prompt = (imgMatch[1] || '').trim();
        if (!prompt) {
          if (channelId) {
            const baseUrl = getConfiguredAppUrl();
            await sendDiscordBotMessage(channelId, `Usage: !img <description>\nImage library: ${baseUrl}/api/ai/image/library?tenantId=${encodeURIComponent(tenantId)}`);
          }
          await markHandled();
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image' });
        }

        if (channelId) {
          await sendDiscordBotMessage(channelId, "I'm processing your image now, Commander.");
        }

        let result;
        try {
          result = await runImageCommand(message, tenantId);
        } catch (error) {
          console.warn(`[Discord Chat:${tenantId}] !img failed:`, error);
          if (channelId) {
            await sendDiscordBotMessage(channelId, 'Image generation failed. Try again in a moment.');
          }
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image', error: 'image-failed' });
        }

        if (!result.images.length) {
          if (channelId) {
            await sendDiscordBotMessage(channelId, 'Image generation returned no image URL.');
          }
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image', error: 'empty-image' });
        }

        if (channelId) {
          if (result.optimizedPrompt) {
            const settings = await readGenerationSettings(tenantId);
            if (settings.showOptimizedPrompt) {
              await sendDiscordBotMessage(channelId, `Optimized prompt: ${result.optimizedPrompt.slice(0, 1500)}`);
            }
          }
          for (const image of result.images) {
            await sendDiscordBotMessage(channelId, await maybeShortenUrl(image));
          }
        }
        await markHandled();
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image', images: result.images });
      }

      const privateRes = await fetch(`${getInternalAppUrl()}/api/private-chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      if (channelId) {
        await sendDiscordBotEmbedReply(channelId, privateReply, tenantId);
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

    // Handle !say - global TTS toggle
    if (!isDirectMessage && message.trim().match(/^!say$/i)) {
      const { readFile, writeFile, mkdir } = await import("fs/promises");
      const sayFilePath = "data/runtime/say-users.json";
      let sayUsers: string[] = [];
      try { sayUsers = JSON.parse(await readFile(sayFilePath, "utf-8")); } catch {}
      const userKey = `${userId}:${channelId}`;
      if (sayUsers.includes(userKey)) {
        sayUsers = sayUsers.filter(k => k !== userKey);
        if (channelId) await sendDiscordRouteReplyOrCollect(channelId, `@${userName}, TTS disabled.`);
      } else {
        sayUsers.push(userKey);
        if (channelId) await sendDiscordRouteReplyOrCollect(channelId, `@${userName}, TTS enabled! Listen: https://streamweaver-new.fly.dev/say-player\nType !say again to disable.`);
      }
      try { await mkdir("data/runtime", { recursive: true }); } catch {}
      await writeFile(sayFilePath, JSON.stringify(sayUsers));
      return apiOk({ success: true, botResponded: Boolean(channelId), context: "say-toggle" });
    }

    // Handle !listen - global TTS link
    if (!isDirectMessage && message.trim().match(/^!listen$/i)) {
      if (channelId) await sendDiscordRouteReplyOrCollect(channelId, `Listen to TTS: https://streamweaver-new.fly.dev/say-player`);
      return apiOk({ success: true, botResponded: Boolean(channelId), context: "listen" });
    }

    // Handle !img in guild channels (not just DMs)
    if (!isDirectMessage && message.trim().match(/^!img(?:\s+(.+))?$/i)) {
      // Only the guild's own tenant should handle !img to prevent multi-bot duplication
      const guildTenant = await resolveGuildTenant(guildId);
      if (guildTenant && tenantId !== guildTenant) {
        return apiOk({ success: true, botResponded: false, skipped: 'img-not-owner-tenant' });
      }
      // If no guild tenant resolved, only let the first tenant (alphabetically) handle it
      if (!guildTenant) {
        const allTenants = await listTenants();
        if (allTenants.length > 1 && tenantId !== allTenants.sort()[0]) {
          return apiOk({ success: true, botResponded: false, skipped: 'img-not-primary-tenant' });
        }
      }

      const imgMatch = message.trim().match(/^!img(?:\s+(.+))?$/i);
      const prompt = (imgMatch?.[1] || '').trim();
      if (!prompt) {
        if (channelId) {
          const baseUrl = getConfiguredAppUrl();
          await sendDiscordRouteReplyOrCollect(channelId, `Usage: !img <description>`);
        }
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'guild-image' });
      }

      if (channelId) {
        await sendDiscordRouteReplyOrCollect(channelId, "I'm processing your image now, Commander.");
      }

      let result;
      try {
        const imgTenantId = tenantId || (await listTenants())[0] || '';
        result = await runImageCommand(message, imgTenantId);
      } catch (error) {
        console.warn(`[Discord Chat:${tenantId}] !img guild failed:`, error);
        if (channelId) {
          await sendDiscordRouteReplyOrCollect(channelId, 'Image generation failed. Try again in a moment.');
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
        const { sendDiscordEmbed } = await import('@/services/discord-local');
        for (const image of result.images) {
          const imageUrl = await maybeShortenUrl(image);
          const embed = await buildDiscordBotEmbed({
            description: result.originalPrompt || prompt,
            tenantId,
            authorName: getBotName(tenantId),
          });
          await sendDiscordEmbed(channelId, {
            embeds: [{
              ...embed,
              title: 'Image Generated',
              image: { url: imageUrl },
            }],
          });
        }
      }
      return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'guild-image', images: result.images });
    }

    // Bridge to Twitch if enabled, dispatch is true, message is from the configured bridge channel,
    // and the bot is NOT mentioned (bot conversations stay in Discord)
    if (!isDirectMessage && message.trim().startsWith('!')) {
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
        const dcPath = tenantPath(tenantId, 'tokens/discord-channels.json');
        let bridgeEnabled = false;
        try {
          const dcConfig = JSON.parse(await fs.readFile(dcPath, 'utf-8'));
          bridgeEnabled = dcConfig.discordBridgeEnabled !== false && dcConfig.logChannelId === channelId;
        } catch {}

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

    // If bot not mentioned, just bridge and return
    if (!botMentioned) {
      // Check if user has TTS enabled via !say — queue to standalone say system
      if (message.trim() && !message.trim().startsWith('!')) {
        const { readFile } = await import('fs/promises');
        const userKey = `${userId}:${channelId}`;
        try {
          const sayUsers: string[] = JSON.parse(await readFile('data/runtime/say-users.json', 'utf-8'));
          if (sayUsers.includes(userKey)) {
            fetch(`${getInternalAppUrl()}/api/say/queue`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: `${userName} says: ${message}` }),
            }).catch(() => {});
          }
        } catch { /* no say-users file = nobody enrolled */ }
      }
      return apiOk({ success: true, botResponded: false });
    }

    // Generate AI response
    const botTenantId = botMatch?.tenantId;
    const botName = botMatch?.botName || getBotName(tenantId);
    if (await isBotTriggerIgnored({
      tenantId: botTenantId || tenantId || undefined,
      botName,
      trigger: botMatch?.trigger,
    }, tenantId)) {
      console.log('[Discord Chat] Bot trigger ignored:', {
        tenantId: tenantId || null,
        botTenantId: botTenantId || null,
        botName,
      });
      return apiOk({ success: true, botResponded: false, ignored: true, botName });
    }
    console.log(`[Discord Chat] ${botName} mentioned by ${userName}, generating response for tenant ${botTenantId || 'global'}...`);

    if (await getBotShareMode(botTenantId || tenantId || undefined) === 'on') {
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
        console.log('[Discord Chat] Bot relay intent detected:', {
          source: relayRequest.source || 'unknown',
          speaker: relaySpeaker.currentName,
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
              await sendDiscordRouteReplyOrCollect(channelId, directMessage);
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

        const ackReply = `I'll pass that along to ${resolvedRelayTarget.character.currentName}.`;
        if (channelId) {
          const deleteAt = getDiscordMessageCleanupDeleteAt();
          const ackEmbed = await buildDiscordBotEmbed({
            description: ackReply,
            tenantId: botTenantId || tenantId || undefined,
            botName,
            deleteAt,
          });
          if (relayOnly) {
            collectReply({ content: ackReply, embeds: [ackEmbed] });
          } else {
            const webhookIdentity = getDiscordBotWebhookIdentity(botTenantId || tenantId, botName);
            const avatarUrl = webhookIdentity.avatarUrl || await getDiscordBotProfileAvatarUrl() || await getAvatarUrlForTenant(botTenantId || tenantId);
            const sentAck = await sendWebhookMessage(channelId, ackReply, webhookIdentity.username, avatarUrl, [ackEmbed]).catch(() => null);
            await recordDiscordMessageCleanup({
              tenantId: botTenantId || tenantId || undefined,
              channelId,
              triggerMessageId: normalized.messageId,
              replyMessageIds: [sentAck?.id || ''],
              replyMessages: [ackReply],
              sourceUser: userName,
              botName,
              triggerMessage: message,
            }).catch(() => {});
          }
        }

        const relayResult = await deliverBotRelay({
          sourcePlatform: 'discord',
          sourceUserName: userName,
          triggerMessage: message,
          speaker: relaySpeaker,
          speakerTenantId: botTenantId || tenantId || undefined,
          target: resolvedRelayTarget.character,
          targetTenantId: resolvedRelayTarget.tenantId,
          relayMessage: relayRequest.relayMessage,
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
          const deleteAt = getDiscordMessageCleanupDeleteAt();
          const ackEmbed = await buildDiscordBotEmbed({
            description: ackReply,
            tenantId: botTenantId || tenantId || undefined,
            botName,
            deleteAt,
          });
          if (relayOnly) {
            collectReply({ content: ackReply, embeds: [ackEmbed] });
          } else {
            const webhookIdentity = getDiscordBotWebhookIdentity(botTenantId || tenantId, botName);
            const avatarUrl = webhookIdentity.avatarUrl || await getDiscordBotProfileAvatarUrl() || await getAvatarUrlForTenant(botTenantId || tenantId);
            const sentAck = await sendWebhookMessage(channelId, ackReply, webhookIdentity.username, avatarUrl, [ackEmbed]).catch(() => null);
            await recordDiscordMessageCleanup({
              tenantId: botTenantId || tenantId || undefined,
              channelId,
              triggerMessageId: normalized.messageId,
              replyMessageIds: [sentAck?.id || ''],
              replyMessages: [ackReply],
              sourceUser: userName,
              botName,
              triggerMessage: message,
            }).catch(() => {});
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
        });

        if (!relayResult.delivered && relayResult.error && channelId) {
          await sendDiscordRouteReplyOrCollect(channelId, `@${userName}, I couldn't reach ${resolvedRelayTarget.character.currentName}: ${relayResult.error}`);
        }

        return apiOk({ success: true, botResponded: true, relayDelivered: relayResult.delivered, relayMode: relayResult.mode || null, replies: relayOnly ? collectedReplies : undefined });
      }
    }

    const aiRes = await fetch(`${getInternalAppUrl()}/api/ai/chat-with-memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      return apiOk({ success: true, botResponded: false, error: 'ai-failed' });
    }

    const aiData = await aiRes.json();
    const aiReply = aiData.response || aiData.data?.response || '';

    if (!aiReply) {
      return apiOk({ success: true, botResponded: false, error: 'empty-response' });
    }

    // Send response to Discord and queue the same reply for the persistent TTS overlay.
    let discordReplySent = false;
    if (channelId) {
      try {
        const deleteAt = getDiscordMessageCleanupDeleteAt();
        const aiEmbed = await buildDiscordBotEmbed({
          description: aiReply,
          tenantId: botTenantId || tenantId || undefined,
          botName,
          deleteAt,
        });
        let sentReply: any = null;
        if (relayOnly) {
          collectReply({ content: aiReply, embeds: [aiEmbed] });
        } else {
          const webhookIdentity = getDiscordBotWebhookIdentity(botTenantId || tenantId, botName);
          const avatarUrl = webhookIdentity.avatarUrl || await getDiscordBotProfileAvatarUrl() || await getAvatarUrlForTenant(botTenantId || tenantId);
          sentReply = await sendWebhookMessage(channelId, aiReply, webhookIdentity.username, avatarUrl, [aiEmbed]);
          const ttsResult = await queueTtsOverlay(aiReply, botTenantId || tenantId || undefined);
          if (!ttsResult.ok) console.warn('[Discord Chat] TTS overlay queue failed:', ttsResult.error);
        }
        discordReplySent = true;
        console.log(`[Discord Chat] Bot responded via webhook in channel ${channelId}`);
        if (!relayOnly && botInteractionDecision?.shouldRespond) {
          await appendBotInteraction({
            platform: 'discord',
            tenantId: botTenantId || tenantId || undefined,
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
              sentReply?.id || '',
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

async function resolveMentionedBot(messageLower: string, guildTenantId?: string): Promise<BotMatch | null> {
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

  addCandidate(guildTenantId);
  await addLoreCandidate(messageLower, candidates, guildTenantId);

  for (const tenantId of await listTenants()) {
    if (tenantId === guildTenantId) continue;
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
  const tenantCharacters = characters.filter((character) => character.stableId.startsWith(`${tenantId}:`));

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
    const raw = await fs.readFile(tenantPath(tenantId, 'tokens/discord-channels.json'), 'utf-8');
    const config = JSON.parse(raw);
    return config.logChannelId || null;
  } catch {
    return null;
  }
}

async function sendDiscordRouteReply(channelId: string, message: string, username = 'StreamWeaver') {
  try {
    await sendDiscordBotMessage(channelId, message);
  } catch (botError) {
    console.warn('[Discord Chat] Bot API send failed, trying webhook fallback:', botError);
    await sendWebhookMessage(channelId, message, username);
  }
}

async function sendDiscordBotEmbedReply(channelId: string, message: string, tenantId?: string) {
  const { sendDiscordEmbed } = await import('@/services/discord-local');
  await sendDiscordEmbed(channelId, {
    embeds: [await buildDiscordBotEmbed({
      description: message,
      tenantId,
      authorName: getBotName(tenantId),
    })],
  });
}

/**
 * Resolve which tenant a Discord guild belongs to by checking discord-channels.json files.
 */
async function resolveGuildTenant(guildId: string): Promise<string | undefined> {
  if (!guildId) {
    try {
      const tenants = await listTenants();
      if (tenants.length === 0) return undefined;
      if (tenants.length === 1) return tenants[0];

      // DM payloads may not include guild context; route ambiguous traffic to the owner tenant.
      const ownerTenantId = (process.env.DISCORD_DM_OWNER_TENANT_ID || getAdminTwitchId()).trim();
      if (ownerTenantId) return ownerTenantId;
    } catch {}
    return undefined;
  }
  try {
    const tenantIds = await listTenants();
    for (const id of tenantIds) {
      try {
        const raw = await fs.readFile(tenantPath(id, 'tokens/discord-channels.json'), 'utf-8');
        const config = JSON.parse(raw);
        if (config.guildId === guildId) return id;
      } catch {}
    }
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
      headers: { 'Content-Type': 'application/json' },
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

    const webhookIdentity = getDiscordBotWebhookIdentity(targetTenantId, target.currentName);
    const avatarUrl = webhookIdentity.avatarUrl || await getDiscordBotProfileAvatarUrl() || await getAvatarUrlForTenant(targetTenantId);
    const deleteAt = getDiscordMessageCleanupDeleteAt();
    const sentReply = await sendWebhookMessage(input.channelId, reply, webhookIdentity.username, avatarUrl, [
      await buildDiscordBotEmbed({
        description: reply,
        tenantId: targetTenantId,
        botName: target.currentName,
        deleteAt,
      }),
    ]);
    const ttsResult = await queueTtsOverlay(reply, targetTenantId);
    if (!ttsResult.ok) console.warn('[Discord Chat] Cross-bot TTS overlay queue failed:', ttsResult.error);
    console.log('[Discord Chat] Cross-bot target responded via webhook:', {
      target: target.currentName,
      channelId: input.channelId,
    });
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
    if (sentReply?.id) replyIds.push(sentReply.id);

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
