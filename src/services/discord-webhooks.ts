import * as fs from 'fs/promises';
import { resolve } from 'path';
import { tenantPath } from '../lib/tenant';

function webhooksFile(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'tokens/discord-webhooks.json');
  return resolve(process.cwd(), 'tokens', 'discord-webhooks.json');
}

interface WebhookData {
  url: string;
  username: string;
  avatarUrl: string;
}

export type SentWebhookMessage = {
  id?: string;
  channel_id?: string;
};

async function loadWebhooks(tenantId?: string): Promise<Record<string, WebhookData>> {
  try {
    const data = await fs.readFile(webhooksFile(tenantId), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveWebhooks(webhooks: Record<string, WebhookData>, tenantId?: string): Promise<void> {
  const filePath = webhooksFile(tenantId);
  await fs.mkdir(resolve(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(webhooks, null, 2));
}

export async function createWebhookForChannel(channelId: string, username: string, avatarUrl: string): Promise<string> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('Discord bot token not configured');

  // Create webhook
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: `StreamWeaver-${username}`,
      avatar: null
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to create webhook: ${response.status}`);
  }

  const webhook = await response.json();
  const webhookUrl = `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}`;

  // Store webhook mapping
  const webhooks = await loadWebhooks();
  webhooks[channelId] = { url: webhookUrl, username, avatarUrl };
  await saveWebhooks(webhooks);

  return webhookUrl;
}

export async function getWebhookForChannel(channelId: string): Promise<WebhookData | null> {
  const webhooks = await loadWebhooks();
  return webhooks[channelId] || null;
}

export async function editWebhookMessage(
  channelId: string,
  messageId: string,
  body: { content?: string; embeds?: Record<string, unknown>[] },
): Promise<boolean> {
  const webhook = await getWebhookForChannel(channelId);
  if (!webhook) return false;

  const response = await fetch(`${webhook.url}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.ok;
}

export async function sendWebhookMessage(channelId: string, message: string, username?: string, avatarUrl?: string, embeds?: Record<string, unknown>[]): Promise<SentWebhookMessage | null> {
  let webhook = await getWebhookForChannel(channelId);
  
  // Create webhook if it doesn't exist
  if (!webhook) {
    const defaultUsername = username || 'StreamWeaver';
    const defaultAvatar = avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
    await createWebhookForChannel(channelId, defaultUsername, defaultAvatar);
    webhook = await getWebhookForChannel(channelId);
  }

  if (!webhook) throw new Error('Failed to create webhook');

  const body: Record<string, unknown> = {
    username: username || webhook.username,
    avatar_url: avatarUrl || webhook.avatarUrl
  };
  if (embeds?.length) {
    body.content = '';
    body.embeds = embeds;
  } else {
    body.content = message;
  }

  const separator = webhook.url.includes('?') ? '&' : '?';
  const response = await fetch(`${webhook.url}${separator}wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Webhook send failed: ${response.status}`);
  }
  return await response.json().catch(() => null);
}