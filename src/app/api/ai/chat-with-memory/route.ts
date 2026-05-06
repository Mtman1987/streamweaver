import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse, getAIConfig } from '@/services/ai-provider';
import { appendPublicChatMessages, readPublicChatMessages, clearPublicChatMemory } from '@/lib/public-chat-store';
import { isCommander, getCommanderSystemPrompt, readCommanderMemory, appendCommanderMemory, formatCommanderHistory } from '@/lib/commander-memory';
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
  tenantId: z.string().trim().max(128).optional(),
});

type AIChatMessage = {
  type: 'user' | 'ai';
  username: string;
  message: string;
  timestamp: string;
};

function formatHistory(messages: AIChatMessage[], botName: string): string {
  if (messages.length === 0) return '';

  const lines = messages.map((m) => {
    const role = m.type === 'ai' ? botName : m.username || 'User';
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

    const { username, message, personality, tenantId } = parsed.data;
    console.log('[AI Chat Memory] Request body:', { username, messageLength: message.length, tenantId: tenantId || 'global' });

    const edenaiKey = process.env.EDENAI_API_KEY;
    if (!edenaiKey) {
      return apiError('Server missing EdenAI API key', { status: 500, code: 'MISSING_CONFIG' });
    }

    const aiConfig = getAIConfig(tenantId);
    const { getBotPersonality } = require('@/lib/bot-settings-store');
    const storedPersonality = getBotPersonality(tenantId);
    const DEFAULTS_PERSONALITY_CHECK = 'You are a helpful AI assistant.';
    const history = await readPublicChatMessages(20, tenantId);

    // Priority: request body personality > stored personality > StreamWeaver87 default
    const defaultPersonality = `You are StreamWeaver87, the onboard AI steward of the Space Mountain. You're friendly, slightly theatrical, and obsessed with keeping passengers (chat) entertained. Keep responses to 1-2 sentences. Address viewers as "passengers" and the streamer as "Captain."`;
    const systemPrompt = personality
      ? `You are an AI assistant with the following personality:\n${personality}`
      : storedPersonality && storedPersonality !== DEFAULTS_PERSONALITY_CHECK
        ? `Your name is ${aiConfig.botName}. ${storedPersonality}`
        : `Your name is ${aiConfig.botName}. ${defaultPersonality}`;

    const historyText = formatHistory(history, aiConfig.botName);

    // Commander override: inject global memory and special system prompt for mtman1987
    let commanderContext = '';
    const userIsCommander = isCommander(username);
    if (userIsCommander) {
      const commanderHistory = await readCommanderMemory(10);
      commanderContext = [
        getCommanderSystemPrompt(),
        formatCommanderHistory(commanderHistory),
      ].filter(Boolean).join('\n\n');
    }

    const promptParts = [
      systemPrompt,
      commanderContext,
      'You are having a conversation. Respond naturally and conversationally.',
      historyText,
      `Latest message from ${userIsCommander ? 'the Commander (M.T.)' : username}: ${message}`,
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
    await appendPublicChatMessages([userEntry], 100, tenantId);

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
      
      // Check for content policy violations
      const isContentViolation = (
        errorText.includes('harassment') ||
        errorText.includes('Content rejected') ||
        errorText.includes('violation of the following policies') ||
        errorText.includes('invalid_request_error') ||
        response.status === 400
      );
      
      if (isContentViolation) {
        console.log('[AI Chat Memory] Content policy violation detected - clearing memory');
        await clearPublicChatMemory(tenantId);
        return apiOk({ 
          response: 'Oops! I need to reset our conversation due to content guidelines. Let\'s start fresh! 🔄',
          memoryCleared: true 
        });
      }
      
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
    await appendPublicChatMessages([aiEntry], 100, tenantId);

    // Save to global commander memory if this was M.T.
    if (userIsCommander) {
      await appendCommanderMemory({
        botName: aiConfig.botName,
        tenantId: tenantId || 'global',
        message,
        response: cleanResponse,
        timestamp: new Date().toISOString(),
      });
    }

    console.log('[AI Chat Memory] Successfully saved messages to public chat file');
    return apiOk({ response: cleanResponse });
  } catch (error) {
    console.error('[AI Chat Memory] API error:', error);
    return apiError('Failed to generate AI response with memory', { status: 500, code: 'INTERNAL_ERROR' });
  }
}