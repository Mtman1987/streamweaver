import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { getBotName, getBotPersonality, getBotInterests } from '@/lib/bot-settings-store';
import { sendWebhookMessage } from '@/services/discord-webhooks';
import { readUserConfigSync } from '@/lib/user-config';
import { listTenants, tenantPath } from '@/lib/tenant';
import { isCommander } from '@/lib/commander-memory';
import { promises as fs } from 'fs';

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

    // Support Kite format (nested under 'root') and direct format
    const data = body.root || body;
    const userId = data.userId || '';
    const guildId = data.guildId || '';
    const userName = data.userName || data.displayName || data.username || 'Unknown';
    const userAvatar = data.userAvatar || data.avatarUrl || '';
    const message = data.message || data.content || '';
    const channelId = data.channelId || '';
    const dispatch = data.dispatch !== false;

    if (!message || message.length === 0) {
      return apiOk({ success: true, skipped: 'empty message' });
    }

    console.log(`[Discord Chat] ${userName}: ${message.slice(0, 100)}`);

    // Resolve which tenant this guild belongs to (or auto-assign on first message)
    let tenantId = await resolveGuildTenant(guildId);

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

    // Check if bot is mentioned
    const botName = getBotName(tenantId);
    const botAliases = (readUserConfigSync(tenantId).AI_BOT_ALIASES || '').toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean);
    const allTriggers = [botName.toLowerCase(), ...botAliases];

    const msgLower = message.toLowerCase();
    const botMentioned = allTriggers.some(trigger => trigger && msgLower.includes(trigger));

    // Bridge to Twitch if enabled, dispatch is true, and message is from the configured bridge channel
    if (dispatch && tenantId && channelId) {
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
    console.log(`[Discord Chat] Bot mentioned by ${userName}, generating response...`);

    const port = process.env.PORT || 3100;
    const aiRes = await fetch(`http://127.0.0.1:${port}/api/ai/chat-with-memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: userName,
        message,
        tenantId: tenantId || undefined,
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

    // Send response via webhook (impersonating the bot with its avatar)
    if (channelId) {
      const avatarUrl = getAvatarUrl(tenantId);
      try {
        await sendWebhookMessage(channelId, aiReply, botName, avatarUrl);
        console.log(`[Discord Chat] Bot responded in channel ${channelId}`);
      } catch (e) {
        console.error('[Discord Chat] Webhook send failed:', e);
        // Fallback: try sending via bot token directly
        try {
          const botToken = process.env.DISCORD_BOT_TOKEN;
          if (botToken) {
            await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
              method: 'POST',
              headers: { 'Authorization': `Bot ${botToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: aiReply }),
            });
          }
        } catch {}
      }
    }

    // TTS for the response (same as Twitch)
    try {
      const ttsRes = await fetch(`http://127.0.0.1:${port}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiReply }),
      });
      if (ttsRes.ok) {
        const ttsData = await ttsRes.json();
        if (ttsData.audioDataUri) {
          const tenantQuery = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
          await fetch(`http://127.0.0.1:${port}/api/tts/current${tenantQuery}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioUrl: ttsData.audioDataUri }),
          }).catch(() => {});
        }
      }
    } catch {}

    return apiOk({ success: true, botResponded: true, response: aiReply });
  } catch (error) {
    console.error('[Discord Chat] Error:', error);
    return apiOk({ success: false, error: 'internal' });
  }
}

/**
 * Resolve which tenant a Discord guild belongs to by checking discord-channels.json files.
 */
async function resolveGuildTenant(guildId: string): Promise<string | undefined> {
  if (!guildId) return undefined;
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
