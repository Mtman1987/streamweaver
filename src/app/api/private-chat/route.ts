import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const PRIVATE_CHAT_FILE = resolve(process.cwd(), 'src', 'data', 'private-chat.json');

interface ChatMessage {
  type: 'user' | 'ai';
  username: string;
  message: string;
  timestamp: string;
}

const privateChatMessageSchema = z.object({
  type: z.enum(['user', 'ai']),
  username: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(4000),
  timestamp: z.string().trim().min(1).max(64),
});

const privateChatArraySchema = z.array(privateChatMessageSchema);

export async function GET(request: NextRequest) {
  try {
    let messages: ChatMessage[] = [];
    try {
      const data = await fs.readFile(PRIVATE_CHAT_FILE, 'utf-8');
      const parsed = privateChatArraySchema.safeParse(JSON.parse(data));
      if (parsed.success) {
        messages = parsed.data;
      }
    } catch (error) {
      // File doesn't exist, return empty array
    }

    return apiOk({ messages });
  } catch (error) {
    console.error('Private chat GET API error:', error);
    return apiError('Failed to load messages', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsedBody = privateChatMessageSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return apiError('Missing required fields', { status: 400, code: 'INVALID_BODY' });
    }

    const { type, username, message, timestamp } = parsedBody.data;

    // Load existing messages
    let messages: ChatMessage[] = [];
    try {
      const data = await fs.readFile(PRIVATE_CHAT_FILE, 'utf-8');
      const parsed = privateChatArraySchema.safeParse(JSON.parse(data));
      if (parsed.success) {
        messages = parsed.data;
      }
    } catch (error) {
      // File doesn't exist, start with empty array
    }

    // Add new message
    messages.push({ type, username, message, timestamp });

    // Keep only last 100 messages
    if (messages.length > 100) {
      messages = messages.slice(-100);
    }

    // Save back to file
    await fs.writeFile(PRIVATE_CHAT_FILE, JSON.stringify(messages, null, 2));

    console.log(`[Private Chat] Saved ${type} message from ${username}`);
    return apiOk({ success: true });

  } catch (error) {
    console.error('Private chat API error:', error);
    return apiError('Failed to save message', { status: 500, code: 'INTERNAL_ERROR' });
  }
}