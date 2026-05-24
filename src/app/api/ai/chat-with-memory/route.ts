import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse, getAIConfig } from '@/services/ai-provider';
import { appendPublicChatMessages, readPublicChatMessages } from '@/lib/public-chat-store';
import { isCommander, getCommanderSystemPrompt, readCommanderMemory, appendCommanderMemory, formatCommanderHistory } from '@/lib/commander-memory';
import { formatWorldLoreForPrompt } from '@/lib/world-lore-store';
import { formatBotInteractionHistoryForPrompt } from '@/lib/bot-interactions-store';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

type RequestBody = {
  username: string;
  message: string;
  personality?: string;
  responseName?: string;
};

const chatWithMemorySchema = z.object({
  username: z.string().trim().min(1, 'Missing required fields: username, message').max(128),
  message: z.string().trim().min(1, 'Missing required fields: username, message').max(5000),
  personality: z.string().trim().max(3000).optional(),
  responseName: z.string().trim().max(128).optional(),
  tenantId: z.string().trim().max(128).optional(),
  context: z.enum(['twitch', 'twitch-cross-bot', 'discord', 'discord-cross-bot', 'voice', 'private']).optional().default('twitch'),
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

    const { username, message, personality, responseName, tenantId: bodyTenantId, context } = parsed.data;
    // Resolve tenant: prefer session cookie (browser requests), fall back to body (server-side internal calls)
    const session = (await import('@/lib/tenant-context')).getTenantFromRequest(request);
    const tenantId = session?.tenantId || bodyTenantId;
    console.log('[AI Chat Memory] Request body:', { username, messageLength: message.length, tenantId: tenantId || 'global', context, source: session?.tenantId ? 'cookie' : 'body' });

    const edenaiKey = process.env.EDENAI_API_KEY;
    if (!edenaiKey) {
      return apiError('Server missing EdenAI API key', { status: 500, code: 'MISSING_CONFIG' });
    }

    const aiConfig = getAIConfig(tenantId);
    const botResponseName = (context === 'discord-cross-bot' || context === 'twitch-cross-bot') && responseName ? responseName : aiConfig.botName;
    const { getBotPersonality } = require('@/lib/bot-settings-store');
    const storedPersonality = getBotPersonality(tenantId);
    const DEFAULTS_PERSONALITY_CHECK = 'You are a helpful AI assistant.';
    const history = await readPublicChatMessages(20, tenantId);

    // Priority: stored tenant personality > StreamWeaver87 default. Cross-bot calls
    // are internal server calls and may provide a temporary target personality.
    const defaultPersonality = `You are StreamWeaver87, the onboard AI steward of the Space Mountain. You're friendly, slightly theatrical, and obsessed with keeping passengers (chat) entertained. Keep responses to 1-2 sentences. Address viewers as "passengers" and the streamer as "Captain."`;
    const rawPersonality = ((context === 'discord-cross-bot' || context === 'twitch-cross-bot') && personality ? personality : null)
      || (storedPersonality && storedPersonality !== DEFAULTS_PERSONALITY_CHECK ? storedPersonality : null)
      || defaultPersonality;

    // Two-tier split: above --- is compact system identity, below is extended guidance
    let systemIdentity: string;
    let extendedGuidance: string;
    if (rawPersonality.includes('\n---\n') || rawPersonality.includes('\n---')) {
      const splitIndex = rawPersonality.indexOf('\n---');
      systemIdentity = rawPersonality.substring(0, splitIndex).trim();
      extendedGuidance = rawPersonality.substring(splitIndex).replace(/^\n---\n?/, '').trim();
    } else {
      // No delimiter — use whole thing as system (graceful fallback)
      systemIdentity = rawPersonality;
      extendedGuidance = '';
    }

    const historyText = formatHistory(history, botResponseName);
    const worldLoreText = await formatWorldLoreForPrompt();
    const botInteractionHistory = await formatBotInteractionHistoryForPrompt();

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

    // Context flag so the AI knows where this conversation is happening
    const contextFlags: Record<string, string> = {
      twitch: '[Context: Live Twitch chat. Keep responses to 1-2 sentences. Many viewers can see this.]',
      'twitch-cross-bot': '[Context: Twitch cross-bot follow-up. Answer as the requested bot only, then stop.]',
      discord: '[Context: Discord server message. Can be slightly longer but stay concise.]',
      'discord-cross-bot': '[Context: Discord cross-bot follow-up. Answer as the requested bot only, then stop.]',
      voice: `[Context: The broadcaster is speaking to you via voice command. This is ${userIsCommander ? 'the Commander (M.T.)' : 'the streamer'}. Respond conversationally.]`,
      private: '[Context: Private conversation. Not on stream. You can be more detailed and personal.]',
    };
    const contextFlag = contextFlags[context] || contextFlags.twitch;

    const promptParts = [
      extendedGuidance,
      worldLoreText,
      botInteractionHistory,
      commanderContext,
      contextFlag,
      historyText,
      `Latest message from ${userIsCommander ? 'the Commander (M.T.)' : username}: ${message}`,
      `Respond as ${botResponseName}:`,
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

    // Use EdenAI API with proper system/user role separation
    const response = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${edenaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash',
        messages: [
          { role: 'system', content: systemIdentity },
          { role: 'user', content: prompt }
        ],
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AI Chat Memory] EdenAI error:', response.status, errorText);
      return apiOk({ response: 'Hmm, let me think about that differently... Could you rephrase?' });
    }

    const data = await response.json();
    let responseText = data.choices?.[0]?.message?.content?.trim() || '';

    if (!responseText) {
      console.log('[AI Chat Memory] AI returned empty response');
      return apiOk({ response: 'Sorry, I had trouble processing that. Could you rephrase?' });
    }

    // Remove bot name prefix if present
    const cleanResponse = responseText.replace(new RegExp(`^(${botResponseName}|${botResponseName.toLowerCase()}):\\s*`, 'i'), '').trim();

    const aiEntry = {
      type: 'ai' as const,
      username: botResponseName,
      message: cleanResponse,
      timestamp: new Date().toISOString(),
    };

    console.log('[AI Chat Memory] Saving AI response:', aiEntry);
    await appendPublicChatMessages([aiEntry], 100, tenantId);

    // Save to global commander memory if this was M.T.
    if (userIsCommander) {
      await appendCommanderMemory({
        botName: botResponseName,
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
