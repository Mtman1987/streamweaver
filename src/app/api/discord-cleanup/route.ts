import { NextRequest, NextResponse } from 'next/server';
import { resolve } from 'path';
import * as fs from 'fs/promises';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const discordCleanupSchema = z.object({
  action: z.enum(['cleanup']).optional().default('cleanup'),
  channelId: z.string().trim().min(1).max(64).optional(),
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

async function getDiscordChannelId(): Promise<string | null> {
    const SETTINGS_FILE = resolve(process.cwd(), 'tokens', 'discord-channels.json');
    const LEGACY_SETTINGS_FILE = resolve(process.cwd(), 'src', 'data', 'discord-channels.json');
    
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
        const settings = JSON.parse(data);
        return settings.logChannelId || null;
    } catch {
        try {
            const legacyData = await fs.readFile(LEGACY_SETTINGS_FILE, 'utf-8');
            const settings = JSON.parse(legacyData);
            return settings.logChannelId || null;
        } catch {
            return null;
        }
    }
}

export async function POST(request: NextRequest) {
  if (!DISCORD_BOT_TOKEN) {
    return apiError('Discord bot token not configured', { status: 500, code: 'MISSING_CONFIG' });
  }

  try {
    const parsed = discordCleanupSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { action, channelId } = parsed.data;

    // Use configured chat log channel if no channelId provided
    const targetChannelId = channelId || await getDiscordChannelId();
    
    if (!targetChannelId) {
      return apiError('No channel ID provided and no chat log channel configured', { status: 400, code: 'INVALID_BODY' });
    }

    if (action === 'cleanup' || !action) {
      return await cleanupNumberedMessages(targetChannelId);
    }

    return apiError('Invalid action', { status: 400, code: 'INVALID_BODY' });
  } catch (error) {
    console.error('Discord cleanup error:', error);
    return apiError('Failed to process request', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function GET(request: NextRequest) {
  const targetChannelId = await getDiscordChannelId();
  
  console.log('[Cleanup] Channel ID found:', targetChannelId);
  
  if (!targetChannelId) {
    return apiError('No chat log channel configured', { status: 400, code: 'INVALID_BODY' });
  }

  return await cleanupNumberedMessages(targetChannelId);
}

async function cleanupNumberedMessages(channelId: string) {
  try {
    let deletedCount = 0;
    let lastMessageId = null;
    let totalProcessed = 0;

    console.log(`[Cleanup] Starting cleanup for channel ${channelId}`);

    while (totalProcessed < 5000) { // Increased safety limit
      const url: string = `https://discord.com/api/v10/channels/${channelId}/messages?limit=100${lastMessageId ? `&before=${lastMessageId}` : ''}`;
      
      const response: Response = await fetch(url, {
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status}`);
      }

      const messages: any[] = await response.json();
      
      if (messages.length === 0) {
        console.log('[Cleanup] No more messages to process');
        break;
      }

      totalProcessed += messages.length;
      console.log(`[Cleanup] Processing batch of ${messages.length} messages (total: ${totalProcessed})`);

      // Delete ALL messages (not just numbered/bot ones)
      const messagesToDelete = messages;
      
      console.log(`[Cleanup] Found ${messagesToDelete.length} messages to delete in this batch`);

      // If no messages to delete in this batch, continue to next batch
      if (messagesToDelete.length === 0) {
        lastMessageId = messages[messages.length - 1].id;
        continue;
      }

      // Delete messages
      for (const message of messagesToDelete) {
        try {
          await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${message.id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
            }
          });
          deletedCount++;
          
          // Rate limit: Discord allows 5 deletes per second
          await new Promise(resolve => setTimeout(resolve, 200));
          
          if (deletedCount % 25 === 0) {
            console.log(`[Cleanup] Deleted ${deletedCount} messages so far...`);
          }
        } catch (err) {
          console.error('Failed to delete message:', message.id, err);
        }
      }

      lastMessageId = messages[messages.length - 1].id;
      
      // If we found fewer than 100 messages, we're at the end
      if (messages.length < 100) {
        console.log('[Cleanup] Reached end of channel history');
        break;
      }
    }

    return apiOk({ 
      success: true, 
      deletedCount,
      totalProcessed,
      channelId: channelId,
      message: `Deleted ${deletedCount} messages (numbered + bot messages, processed ${totalProcessed} total messages)`
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return apiError('Cleanup failed', {
      status: 500,
      code: 'INTERNAL_ERROR',
      details: {
        message: error instanceof Error ? error.message : String(error),
        channelId,
      },
    });
  }
}