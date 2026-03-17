import * as fs from 'fs';
import * as path from 'path';

const LAST_MESSAGE_FILE = path.join(process.cwd(), 'data', 'discord-last-tag-message.json');

interface LastMessage {
  messageId: string;
  webhookId: string;
  webhookToken: string;
}

function loadLastMessage(): LastMessage | null {
  try {
    if (fs.existsSync(LAST_MESSAGE_FILE)) {
      return JSON.parse(fs.readFileSync(LAST_MESSAGE_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('[Discord] Failed to load last message:', error);
  }
  return null;
}

function saveLastMessage(data: LastMessage) {
  try {
    fs.writeFileSync(LAST_MESSAGE_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[Discord] Failed to save last message:', error);
  }
}

export async function sendDiscordTagAnnouncement(message: string): Promise<void> {
  const webhookUrl = process.env.DISCORD_TAG_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('[Discord] No webhook URL configured');
    return;
  }

  try {
    // Delete previous message if exists
    const lastMessage = loadLastMessage();
    if (lastMessage) {
      try {
        const deleteUrl = `https://discord.com/api/webhooks/${lastMessage.webhookId}/${lastMessage.webhookToken}/messages/${lastMessage.messageId}`;
        console.log('[Discord] Attempting to delete message:', lastMessage.messageId);
        const deleteResponse = await fetch(deleteUrl, { method: 'DELETE' });
        if (deleteResponse.ok || deleteResponse.status === 404) {
          console.log('[Discord] Successfully deleted or message not found');
        } else {
          console.error('[Discord] Delete failed:', deleteResponse.status, await deleteResponse.text());
        }
      } catch (error) {
        console.error('[Discord] Failed to delete previous message:', error);
      }
    } else {
      console.log('[Discord] No previous message to delete');
    }

    // Send new message with wait=true to get the message ID back
    console.log('[Discord] Sending new message:', message);
    const response = await fetch(`${webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('[Discord] New message ID:', data.id);
      
      // Extract webhook ID and token from URL
      const urlParts = webhookUrl.match(/webhooks\/(\d+)\/([^\/]+)/);
      
      if (urlParts && data.id) {
        const messageData = {
          messageId: data.id,
          webhookId: urlParts[1],
          webhookToken: urlParts[2]
        };
        saveLastMessage(messageData);
        console.log('[Discord] Saved new message ID for next deletion');
      } else {
        console.error('[Discord] Could not extract webhook info or message ID');
      }
    } else {
      console.error('[Discord] Failed to send message:', response.status, await response.text());
    }
  } catch (error) {
    console.error('[Discord] Error in sendDiscordTagAnnouncement:', error);
  }
}
