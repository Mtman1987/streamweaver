import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getChannelMessages } from '@/services/discord';
import { addLTMEntry } from '@/lib/ltm-store';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

type RequestBody = {
  channelId: string;
  messageCount?: number;
};

const ltmCondenseSchema = z.object({
  channelId: z.string().trim().min(1, 'Missing channelId').max(64),
  messageCount: z.coerce.number().int().min(1).max(500).optional(),
});

async function condenseChatHistory(channelId: string): Promise<{ title: string; content: string } | null> {
  try {
    // Get last 50 messages from Discord
    const messages = await getChannelMessages(channelId, 50) as Array<{ content?: string }>;
    
    const chatHistory = messages
      .filter((msg) => typeof msg.content === 'string' && msg.content.match(/^\[\d+\]\[AI\]\[U1\]/))
      .map((msg) => {
        const content = msg.content ?? '';
        const match = content.match(/^\[\d+\]\[AI\]\[U1\] (.*?): "(.*)"/);
        if (match) {
          const [, speaker, text] = match;
          return `${speaker}: ${text}`;
        }
        return null;
      })
      .filter(Boolean)
      .reverse()
      .join('\n');
    
    if (!chatHistory) return null;
    
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) throw new Error('Missing API key');
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `Analyze this conversation and create a Long Term Memory (LTM) entry:

${chatHistory}

Create:
1. A short title with 3-5 key words that capture the main topic/theme
2. A 5-10 sentence summary of the key points, decisions, or important information

Format your response as:
TITLE: [your title here]
CONTENT: [your 5-10 sentence summary here]`;
    
    const result = await model.generateContent(prompt);
    const response = result.response.text()?.trim();
    
    if (!response) return null;
    
    const titleMatch = response.match(/TITLE:\s*(.+)/);
    const contentMatch = response.match(/CONTENT:\s*([\s\S]+)/);
    
    if (titleMatch && contentMatch) {
      return {
        title: titleMatch[1].trim(),
        content: contentMatch[1].trim()
      };
    }
    
    return null;
  } catch (error) {
    console.error('[LTM Condense] Error:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = ltmCondenseSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Missing channelId', { status: 400, code: 'INVALID_BODY' });
    }
    const { channelId } = parsed.data;
    
    const ltmEntry = await condenseChatHistory(channelId);
    
    if (ltmEntry) {
      await addLTMEntry(ltmEntry.title, ltmEntry.content);
      console.log('[LTM] Created new memory:', ltmEntry.title);
      return apiOk({ 
        success: true, 
        title: ltmEntry.title,
        content: ltmEntry.content 
      });
    }
    
    return apiError('Failed to condense history', { status: 502, code: 'UPSTREAM_ERROR', details: { success: false } });
  } catch (error) {
    console.error('[LTM Condense API] Error:', error);
    return apiError('Failed to condense chat history', { status: 500, code: 'INTERNAL_ERROR' });
  }
}