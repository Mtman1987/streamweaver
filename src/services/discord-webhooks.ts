import * as fs from 'fs/promises';
import { resolve } from 'path';

const WEBHOOKS_FILE = resolve(process.cwd(), 'tokens', 'discord-webhooks.json');

interface WebhookData {
  url: string;
  username: string;
  avatarUrl: string;
}

async function loadWebhooks(): Promise<Record<string, WebhookData>> {
  try {
    const data = await fs.readFile(WEBHOOKS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveWebhooks(webhooks: Record<string, WebhookData>): Promise<void> {
  await fs.writeFile(WEBHOOKS_FILE, JSON.stringify(webhooks, null, 2));
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

export async function sendWebhookMessage(channelId: string, message: string, username?: string, avatarUrl?: string): Promise<void> {
  let webhook = await getWebhookForChannel(channelId);
  
  // Create webhook if it doesn't exist
  if (!webhook) {
    const defaultUsername = username || 'StreamWeaver';
    const defaultAvatar = avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
    await createWebhookForChannel(channelId, defaultUsername, defaultAvatar);
    webhook = await getWebhookForChannel(channelId);
  }

  if (!webhook) throw new Error('Failed to create webhook');

  const response = await fetch(webhook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: message,
      username: username || webhook.username,
      avatar_url: avatarUrl || webhook.avatarUrl
    })
  });

  if (!response.ok) {
    throw new Error(`Webhook send failed: ${response.status}`);
  }
}