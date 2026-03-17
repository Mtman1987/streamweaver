import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse, getAIConfig } from '@/services/ai-provider';
import { appendPublicChatMessages, readPublicChatMessages } from '@/lib/public-chat-store';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

type RequestBody = {
  username: string;
  message: string;
  personality?: string;
};

const chatWithMemorySchema = z.object({
  username: z.string().trim().min(1, 'Missing required fields: username, message').max(128),
  message: z.string().trim().min(1, 'Missing required fields: username, message').max(5000),
  personality: z.string().trim().max(3000).optional(),
});

type AIChatMessage = {
  type: 'user' | 'ai';
  username: string;
  message: string;
  timestamp: string;
};

function formatHistory(messages: AIChatMessage[]): string {
  if (messages.length === 0) return '';

  const lines = messages.map((m) => {
    const role = m.type === 'ai' ? getAIConfig().botName : m.username || 'User';
    return `${role}: ${m.message}`;
  });

  return `Conversation so far:\n${lines.join('\n')}`;
}

export async function POST(request: NextRequest) {
  console.log('[AI Chat Memory] POST request received');
  
  try {
    const parsed = chatWithMemorySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      console.log('[AI Chat Memory] Missing required fields');
      return apiError('Missing required fields: username, message', { status: 400, code: 'INVALID_BODY' });
    }

    const { username, message, personality } = parsed.data;
    console.log('[AI Chat Memory] Request body:', { username, messageLength: message.length });

    const edenaiKey = process.env.EDENAI_API_KEY;
    if (!edenaiKey) {
      return apiError('Server missing EdenAI API key', { status: 500, code: 'MISSING_CONFIG' });
    }

    const aiConfig = getAIConfig();
    const history = await readPublicChatMessages(20);

    const systemPrompt = personality
      ? `You are an AI assistant with the following personality:\n${personality}`
      : `You are a helpful AI assistant for a streamer. Your name is ${aiConfig.botName}.`;

    const historyText = formatHistory(history);

    const promptParts = [
      systemPrompt,
      'You are having a conversation. Respond naturally and conversationally.',
      historyText,
      `Latest message from ${username}: ${message}`,
      `Respond as ${aiConfig.botName}:`,
    ].filter(Boolean);

    const prompt = promptParts.join('\n\n');

    const userEntry = {
      type: 'user' as const,
      username,
      message,
      timestamp: new Date().toISOString(),
    };

    console.log('[AI Chat Memory] Saving user message:', userEntry);
    await appendPublicChatMessages([userEntry]);

    // Use EdenAI API with hardcoded model like private chat
    const response = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${edenaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AI Chat Memory] EdenAI error:', response.status, errorText);
      return apiOk({ response: 'Sorry, I had trouble processing that. Could you rephrase?' });
    }

    const data = await response.json();
    let responseText = data.choices?.[0]?.message?.content?.trim() || '';

    if (!responseText) {
      console.log('[AI Chat Memory] AI returned empty response');
      return apiOk({ response: 'Sorry, I had trouble processing that. Could you rephrase?' });
    }

    // Remove bot name prefix if present
    const cleanResponse = responseText.replace(new RegExp(`^(${aiConfig.botName}|${aiConfig.botName.toLowerCase()}):\\s*`, 'i'), '').trim();

    const aiEntry = {
      type: 'ai' as const,
      username: aiConfig.botName,
      message: cleanResponse,
      timestamp: new Date().toISOString(),
    };

    console.log('[AI Chat Memory] Saving AI response:', aiEntry);
    await appendPublicChatMessages([aiEntry]);

    console.log('[AI Chat Memory] Successfully saved messages to public chat file');
    return apiOk({ response: cleanResponse });
  } catch (error) {
    console.error('[AI Chat Memory] API error:', error);
    return apiError('Failed to generate AI response with memory', { status: 500, code: 'INTERNAL_ERROR' });
  }
}