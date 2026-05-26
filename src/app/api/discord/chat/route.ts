import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { getBotAliases, getBotName } from '@/lib/bot-settings-store';
import { sendWebhookMessage } from '@/services/discord-webhooks';
import { readUserConfigSync } from '@/lib/user-config';
import { listTenants, tenantPath } from '@/lib/tenant';
import { appendBotInteraction, decideBotInteraction, getBotShareMode, toggleBotShareMode } from '@/lib/bot-interactions-store';
import { readWorldLore, type WorldLoreCharacter } from '@/lib/world-lore-store';
import { sendDiscordMessage as sendDiscordBotMessage } from '@/services/discord-local';
import { promises as fs } from 'fs';
import { getGenMode, setGenMode, toggleGenMode } from '@/lib/gen-mode-store';
import { readGenerationSettings } from '@/lib/gen-settings-store';

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
    let body;
    try {
      body = await request.json();
    } catch {
      const raw = await request.text();
      body = JSON.parse(raw.replace(/[\x00-\x1F\x7F]/g, ''));
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
    const permissionFieldsPresent =
      normalized.isAdmin !== undefined ||
      normalized.isMod !== undefined ||
      normalized.isOwner !== undefined ||
      normalized.memberPermissions !== undefined;
    const permissions = Array.isArray(normalized.memberPermissions)
      ? normalized.memberPermissions
      : String(normalized.memberPermissions || '').split(/[,\s]+/).filter(Boolean);
    const canManageBotShare = !permissionFieldsPresent || Boolean(
      normalized.isAdmin ||
      normalized.isMod ||
      normalized.isOwner ||
      permissions.includes('ManageGuild') ||
      permissions.includes('Administrator')
    );

    if (!message || message.length === 0) {
      return apiOk({ success: true, skipped: 'empty message' });
    }

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

    // Resolve which tenant this guild belongs to (or auto-assign on first message)
    let tenantId = normalized.tenantId || await resolveGuildTenant(guildId);

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
          await sendDiscordRouteReply(replyChannelId, `@${userName}, only mods/admins can change bot share mode.`);
        }
        return apiOk({ success: true, botResponded: true, error: 'not-authorized' });
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
        await sendDiscordRouteReply(replyChannelId, `Bot share mode: ${mode.toUpperCase()} - cross-bot replies are ${mode === 'on' ? 'enabled' : 'disabled'}.`);
      }
      return apiOk({ success: true, botResponded: Boolean(replyChannelId), mode });
    }

    const botMatch = await resolveMentionedBot(msgLower, tenantId);
    const botMentioned = Boolean(botMatch);

    if (isDirectMessage) {
      if (!tenantId) {
        return apiOk({ success: true, botResponded: false, error: 'tenant-not-found' });
      }

      const imgMatch = message.trim().match(/^!img(?:\s+(.+))?$/i);
      const genModeMatch = message.trim().match(/^!genmode(?:\s+(eden|seaart|perchance|status))?$/i);
      if (genModeMatch) {
        const action = (genModeMatch[1] || '').toLowerCase();
        const mode = action === 'eden' || action === 'seaart' || action === 'perchance'
          ? await setGenMode(action, tenantId)
          : action === 'status'
            ? await getGenMode(tenantId)
            : await toggleGenMode(tenantId);
        if (channelId) await sendDiscordBotMessage(channelId, `Generation mode: ${mode.toUpperCase()}`);
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-genmode', mode });
      }
      if (imgMatch) {
        const prompt = (imgMatch[1] || '').trim();
        if (!prompt) {
          if (channelId) {
            const baseUrl = process.env.NEXT_PUBLIC_STREAMWEAVE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://streamweaver-new.fly.dev';
            await sendDiscordBotMessage(channelId, `Usage: !img <description>\nImage library: ${baseUrl}/api/ai/image/library?tenantId=${encodeURIComponent(tenantId)}`);
          }
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image' });
        }

        const port = process.env.PORT || 3100;
        const genDefaults = await readGenerationSettings(tenantId);
        if (channelId) {
          await sendDiscordBotMessage(channelId, "I'm processing your image now, Commander.");
        }
        const imageRes = await fetch(`http://127.0.0.1:${port}/api/ai/image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            tenantId,
            model: genDefaults.model || undefined,
            resolution: genDefaults.resolution || undefined,
            numImages: genDefaults.imageCount || 1,
            providerParams: {
              lora: genDefaults.lora || undefined,
              loraStrength: genDefaults.loraStrength,
              steps: genDefaults.steps,
              cfg: genDefaults.cfg,
              seed: genDefaults.seed,
            },
          }),
        });

        if (!imageRes.ok) {
          if (channelId) {
            await sendDiscordBotMessage(channelId, 'Image generation failed. Try again in a moment.');
          }
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image', error: 'image-failed' });
        }

        const imageData = await imageRes.json();
        const imageUrl = await maybeShortenUrl(imageData?.image || imageData?.imageResourceUrl || imageData?.data?.image || '');
        if (!imageUrl) {
          if (channelId) {
            await sendDiscordBotMessage(channelId, 'Image generation returned no image URL.');
          }
          return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image', error: 'empty-image' });
        }

        if (channelId) {
          await sendDiscordBotMessage(channelId, imageUrl);
        }
        return apiOk({ success: true, botResponded: Boolean(channelId), tenantId, context: 'private-image', image: imageUrl });
      }

      const port = process.env.PORT || 3100;
      const privateRes = await fetch(`http://127.0.0.1:${port}/api/private-chat/respond`, {
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
        await sendDiscordBotMessage(channelId, privateReply);
      }

      return apiOk({
        success: true,
        botResponded: Boolean(channelId),
        response: privateReply,
        tenantId,
        context: 'private',
      });
    }

    // Bridge to Twitch if enabled, dispatch is true, message is from the configured bridge channel,
    // and the bot is NOT mentioned (bot conversations stay in Discord)
    if (dispatch && tenantId && channelId && !botMentioned) {
      try {
        const dcPath = tenantPath(tenantId, 'tokens/discord-channels.json');
        let bridgeEnabled = false;
        try {
          const dcConfig = JSON.parse(await fs.readFile(dcPath, 'utf-8'));
          bridgeEnabled = dcConfig.discordBridgeEnabled !== false && dcConfig.logChannelId === channelId;
        } catch {}

        if (bridgeEnabled) {
          const { sendChatMessage } = require('@/services/twitch');
          const twitchMsg = `[Discord] ${userName}: ${message}`;
          await sendChatMessage(twitchMsg, 'bot', undefined, tenantId);
        }
      } catch (e) {
        console.warn('[Discord Chat] Twitch bridge failed:', e);
      }
    }

    // If bot not mentioned, just bridge and return
    if (!botMentioned) {
      return apiOk({ success: true, botResponded: false });
    }

    // Generate AI response
    const botTenantId = botMatch?.tenantId;
    const botName = botMatch?.botName || getBotName(tenantId);
    console.log(`[Discord Chat] ${botName} mentioned by ${userName}, generating response for tenant ${botTenantId || 'global'}...`);

    const botInteractionDecision = await decideBotInteraction({
      message,
      currentBotName: botName,
      tenantId: botTenantId || tenantId || undefined,
      platform: 'discord',
    });

    const port = process.env.PORT || 3100;
    const aiRes = await fetch(`http://127.0.0.1:${port}/api/ai/chat-with-memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: userName,
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

    // Send response to Discord only (no Twitch, no TTS — conversation stays in Discord)
    let discordReplySent = false;
    if (channelId) {
      const avatarUrl = getAvatarUrl(botTenantId || tenantId);
      try {
        await sendWebhookMessage(channelId, aiReply, botName, avatarUrl);
        discordReplySent = true;
        console.log(`[Discord Chat] Bot responded via webhook in channel ${channelId}`);
        if (botInteractionDecision?.shouldRespond) {
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

        const followUpDecision = botInteractionDecision?.shouldRespond
          ? botInteractionDecision
          : await decideReplyMentionInteraction({
            speakerBotName: botName,
            speakerTenantId: botTenantId || tenantId || undefined,
            triggerMessage: message,
            speakerReply: aiReply,
          });
        await sendCrossBotTargetReplies({
          channelId,
          userName,
          triggerMessage: message,
          speakerReply: aiReply,
          decision: followUpDecision,
          tenantId: botTenantId || tenantId || undefined,
        }).catch((error) => console.error('[Discord Chat] Cross-bot target reply failed:', error));
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

/**
 * Resolve which tenant a Discord guild belongs to by checking discord-channels.json files.
 */
async function resolveGuildTenant(guildId: string): Promise<string | undefined> {
  if (!guildId) {
    try {
      const tenants = await listTenants();
      if (tenants.length === 0) return undefined;
      if (tenants.length === 1) return tenants[0];

      // DM payloads may not include guild context; default to owner tenant for reliability.
      // Configurable via DISCORD_DM_OWNER_TENANT_ID (falls back to legacy hardcoded value
      // for backwards compatibility with existing deployments).
      const ownerTenantId = (process.env.DISCORD_DM_OWNER_TENANT_ID || '94371378').trim();
      if (ownerTenantId && tenants.includes(ownerTenantId)) return ownerTenantId;
      return [...tenants].sort((a, b) => a.localeCompare(b))[0];
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
  // Fallback: return first tenant (single-tenant compat)
  try {
    const tenants = await listTenants();
    if (tenants.length === 1) return tenants[0];
  } catch {}
  return undefined;
}

/**
 * Get the bot's avatar URL for Discord webhook impersonation.
 * Uses the idle avatar if available, falls back to a default.
 */
function getAvatarUrl(tenantId?: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_STREAMWEAVE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://streamweaver-new.fly.dev';
  // Use the avatar API endpoint which serves the idle image
  if (tenantId) {
    return `${baseUrl}/api/avatars?type=idle&format=gif&tenant=${tenantId}`;
  }
  return `${baseUrl}/api/avatars?type=idle&format=gif`;
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
  const targets = uniqueDiscordCharacters([...directTargets, ...relationshipTargets]);

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
}) {
  const decision = input.decision;
  if (!decision?.shouldRespond || !decision.targets.length) {
    console.log('[Discord Chat] Cross-bot follow-up skipped: no decision');
    return;
  }

  const port = process.env.PORT || 3100;
  const target = decision.targets[0];
  const targetTenantId = tenantIdFromStableId(target.stableId);
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
    `${decision.speaker.currentName} was asked to contact you and replied: "${input.speakerReply}"`,
    `${input.userName} originally asked: "${input.triggerMessage}"`,
    'Answer as yourself in 1-2 short sentences. If this asks about a real streamer schedule and you do not know, say you are not sure and point them to the streamer or channel info. Do not impersonate the other bot.',
  ].filter(Boolean).join('\n');

  const aiRes = await fetch(`http://127.0.0.1:${port}/api/ai/chat-with-memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: input.userName,
      message: prompt,
      personality: targetPersonality,
      responseName: target.currentName,
      tenantId: targetTenantId,
      context: 'discord-cross-bot',
    }),
  });

  if (!aiRes.ok) {
    console.error('[Discord Chat] Cross-bot target AI failed:', aiRes.status, await aiRes.text().catch(() => ''));
    return;
  }

  const data = await aiRes.json();
  const reply = data.response || data.data?.response || '';
  if (!reply.trim()) {
    console.log('[Discord Chat] Cross-bot target AI returned empty response', {
      target: target.currentName,
    });
    return;
  }

  await sendWebhookMessage(input.channelId, reply, target.currentName, getAvatarUrl(targetTenantId));
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
    targetBotIds: [decision.speaker.stableId],
    targetBotNames: [decision.speaker.currentName],
    triggerMessage: input.triggerMessage,
    responseMessage: reply,
  }).catch(() => {});
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
