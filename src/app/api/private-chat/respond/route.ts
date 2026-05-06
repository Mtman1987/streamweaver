import { NextRequest, NextResponse } from 'next/server';
import {
  appendPrivateChatMessages,
  readPrivateChatMessages,
  type PrivateChatMessage,
} from '@/lib/private-chat-store';
import { getPrivateLTMTitles, incrementPrivateMessageCount, getPrivateMessageCount } from '@/lib/private-ltm-store';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

type RequestBody = {
  username: string;
  message: string;
  personality?: string;
  historyLimit?: number;
};

const privateRespondSchema = z.object({
  username: z.string().trim().min(1, 'username is required').max(128),
  message: z.string().trim().min(1, 'message is required').max(5000),
  personality: z.string().trim().max(3000).optional(),
  historyLimit: z.coerce.number().int().min(0).max(100).optional().default(20),
});

function formatHistory(messages: PrivateChatMessage[]): string {
  if (messages.length === 0) return '';

  const lines = messages.map((m) => {
    const role = m.type === 'ai' ? (m.username || 'AI') : (m.username || 'User');
    return `${role}: ${m.message}`;
  });

  return `Conversation so far:\n${lines.join('\n')}`;
}

async function checkAndCondensePrivateMemory(): Promise<void> {
  try {
    const messageCount = await getPrivateMessageCount();
    if (messageCount > 0 && messageCount % 50 === 0) {
      console.log(`[Private LTM] Message count reached ${messageCount}, condensing history...`);
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_STREAMWEAVE_URL || 'http://localhost:3100'}/api/private-ltm/condense`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('[Private LTM] Successfully condensed memory:', data.title);
      }
    }
  } catch (error) {
    console.error('[Private LTM] Failed to condense memory:', error);
  }
}

export async function POST(request: NextRequest) {
  console.log('[Private Chat API] POST request received');
  
  try {
    const parsed = privateRespondSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      console.log('[Private Chat API] Missing required fields');
      return apiError('Missing required fields: username, message', { status: 400, code: 'INVALID_BODY' });
    }

    const { username, message, personality, historyLimit } = parsed.data;
    console.log('[Private Chat API] Request body:', { username, messageLength: message.length });

    const edenaiKey = process.env.EDENAI_API_KEY;
    if (!edenaiKey) {
      return apiError('Server missing EdenAI API key', { status: 500, code: 'MISSING_CONFIG' });
    }

    // Increment message count and check for LTM condensation
    const messageCount = await incrementPrivateMessageCount();
    await checkAndCondensePrivateMemory();

    const history = await readPrivateChatMessages(historyLimit);

    // Get LTM titles for context
    const ltmTitles = await getPrivateLTMTitles();
    const ltmContext = ltmTitles.length > 0 
      ? `\n\nLong Term Memory titles (request full content if relevant): ${ltmTitles.join(', ')}`
      : '';

    const systemPrompt = personality
      ? `You are an AI assistant with the following personality:\n${personality}`
      : `You are a helpful AI assistant for a streamer. Your name is ${(global as any).botName || 'AI'}.`;

    // Check if this is a private conversation
    const isPrivateConversation = message.startsWith('[Private conversation]');
    const cleanMessage = isPrivateConversation ? message.replace('[Private conversation]', '').trim() : message;
    
    const privacyContext = isPrivateConversation 
      ? 'This is a private conversation - you can speak freely about personal topics, secrets, or sensitive information that you would not share publicly.'
      : '';

    const historyText = formatHistory(history);

    const promptParts = [
      systemPrompt,
      privacyContext,
      'You are having a private conversation. Respond naturally and conversationally.',
      'If you need more context from Long Term Memory, respond with: "LTM_REQUEST: [exact title]" and I will provide the full content.',
      historyText,
      `Latest message from ${username}: ${cleanMessage}${ltmContext}`,
      `Respond as ${(global as any).botName || 'AI'}:`,
    ].filter(Boolean);

    const prompt = promptParts.join('\n\n');

    const userEntry: PrivateChatMessage = {
      type: 'user',
      username,
      message: cleanMessage,
      timestamp: new Date().toISOString(),
    };

    console.log('[Private Chat API] Saving user message:', userEntry);
    await appendPrivateChatMessages([userEntry]);

    // Use EdenAI API
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
      console.error('[Private Chat API] EdenAI error:', response.status, errorText);
      return apiError('EdenAI API failed', {
        status: 502,
        code: 'UPSTREAM_ERROR',
        details: { upstreamStatus: response.status },
      });
    }

    const data = await response.json();
    let responseText = data.choices?.[0]?.message?.content?.trim() || '';

    // Handle LTM requests
    const ltmRequestMatch = responseText.match(/LTM_REQUEST:\s*(.+)/);
    if (ltmRequestMatch) {
      const requestedTitle = ltmRequestMatch[1].trim();
      
      try {
        const ltmResponse = await fetch(`${process.env.NEXT_PUBLIC_STREAMWEAVE_URL || 'http://localhost:3100'}/api/private-ltm/retrieve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: requestedTitle })
        });
        
        if (ltmResponse.ok) {
          const ltmData = await ltmResponse.json();
          
          // Re-generate response with LTM content
          const enhancedPrompt = promptParts.join('\n\n') + `\n\nLTM Content for "${requestedTitle}": ${ltmData.content}\n\nNow respond as Athena (do not repeat the LTM content):`;
          
          const enhancedResponse = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${edenaiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'openai/gpt-4o-mini',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: enhancedPrompt }
              ],
              stream: false
            })
          });
          
          if (enhancedResponse.ok) {
            const enhancedData = await enhancedResponse.json();
            responseText = enhancedData.choices?.[0]?.message?.content?.trim() || responseText;
          }
        }
      } catch (error) {
        console.error('[Private Chat] Failed to retrieve LTM:', error);
        responseText = responseText || 'I apologize, I had trouble accessing my memory.';
      }
    }

    if (!responseText) {
      console.log('[Private Chat API] AI returned empty response');
      return apiError('AI returned an empty response', { status: 502, code: 'EMPTY_RESPONSE' });
    }

    const aiEntry: PrivateChatMessage = {
      type: 'ai',
      username: (global as any).botName || 'AI',
      message: responseText,
      timestamp: new Date().toISOString(),
    };

    console.log('[Private Chat API] Saving AI response:', aiEntry);
    await appendPrivateChatMessages([aiEntry]);

    console.log('[Private Chat API] Successfully saved both messages');
    return apiOk({ response: responseText });
  } catch (error) {
    console.error('Private chat respond API error:', error);
    return apiError('Failed to generate private chat response', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
