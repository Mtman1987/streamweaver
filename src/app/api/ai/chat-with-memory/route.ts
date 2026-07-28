import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse, getAIConfig } from '@/services/ai-provider';
import { appendPublicChatMessages, readPublicChatMessages } from '@/lib/public-chat-store';
import { isCommander, getCommanderSystemPrompt, readCommanderMemory, appendCommanderMemory, formatCommanderHistory } from '@/lib/commander-memory';
import { formatWorldLoreForPrompt } from '@/lib/world-lore-store';
import { formatBotInteractionHistoryForPrompt } from '@/lib/bot-interactions-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { hasInternalServiceAccess, hasMountainViewBridgeAccess } from '@/lib/internal-service-auth';
import { resolveResearchMode } from '@/services/research-mode';
import { z } from 'zod';

type RequestBody = {
  username: string;
  message: string;
  userId?: string;
  displayName?: string;
  guildId?: string;
  guildName?: string;
  channelId?: string;
  channelName?: string;
  channelType?: string | number;
  messageId?: string;
  createdAt?: string;
  isDirectMessage?: boolean;
  personality?: string;
  responseName?: string;
};

const VERBOSE_LOGS = process.env.STREAMWEAVER_VERBOSE_LOGS === 'true';

const chatWithMemorySchema = z.object({
  username: z.string().trim().min(1, 'Missing required fields: username, message').max(128),
  message: z.string().trim().min(1, 'Missing required fields: username, message').max(5000),
  userId: z.string().trim().max(128).optional(),
  displayName: z.string().trim().max(128).optional(),
  guildId: z.string().trim().max(128).optional(),
  guildName: z.string().trim().max(128).optional(),
  channelId: z.string().trim().max(128).optional(),
  channelName: z.string().trim().max(128).optional(),
  channelType: z.union([z.string(), z.number()]).optional(),
  messageId: z.string().trim().max(128).optional(),
  createdAt: z.string().trim().max(128).optional(),
  isDirectMessage: z.boolean().optional(),
  personality: z.string().trim().max(3000).optional(),
  responseName: z.string().trim().max(128).optional(),
  tenantId: z.string().trim().max(128).optional(),
  context: z.enum(['twitch', 'twitch-cross-bot', 'discord', 'discord-cross-bot', 'kick', 'voice', 'private']).optional().default('twitch'),
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
  if (VERBOSE_LOGS) console.log('[AI Chat Memory] POST request received');
  
  try {
    const parsed = chatWithMemorySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      console.log('[AI Chat Memory] Missing required fields');
      return apiError('Missing required fields: username, message', { status: 400, code: 'INVALID_BODY' });
    }

    const {
      username,
      userId,
      displayName,
      guildId,
      guildName,
      channelId,
      channelName,
      channelType,
      messageId,
      createdAt,
      isDirectMessage,
      message,
      personality,
      responseName,
      tenantId: bodyTenantId,
      context,
    } = parsed.data;
    const session = getTenantFromRequest(request);
    const hasServiceAccess = hasInternalServiceAccess(request);
    const hasMountainViewAccess = hasMountainViewBridgeAccess(request);
    if (!session?.tenantId && !hasServiceAccess && !hasMountainViewAccess) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }
    const tenantId = session?.tenantId || ((hasServiceAccess || hasMountainViewAccess) ? bodyTenantId : undefined);
    if (!tenantId) {
      return apiError('Tenant context required', { status: 400, code: 'TENANT_REQUIRED' });
    }
    if (VERBOSE_LOGS) {
      console.log('[AI Chat Memory] Request body:', { username, messageLength: message.length, tenantId: tenantId || 'global', context, source: session?.tenantId ? 'cookie' : 'body' });
    }

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

    const research = await resolveResearchMode({
      tenantId,
      botName: botResponseName,
      username,
      platform: context,
      channelId,
      message,
    });

    if (research.kind === 'prompt') {
      const timestamp = new Date().toISOString();
      await appendPublicChatMessages([
        { type: 'user', username, message, timestamp },
        { type: 'ai', username: botResponseName, message: research.response, timestamp },
      ], 100, tenantId);
      return apiOk({ response: research.response, research: { state: 'awaiting-query', sources: [] } });
    }

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
    const botInteractionHistory = await formatBotInteractionHistoryForPrompt(8, tenantId);

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
      kick: '[Context: Live Kick chat. Keep responses to 1-2 sentences. Many viewers can see this.]',
      voice: `[Context: The broadcaster is speaking to you via voice command. This is ${userIsCommander ? 'the Commander (M.T.)' : 'the streamer'}. Respond conversationally.]`,
      private: '[Context: Private conversation. Not on stream. You can be more detailed and personal.]',
    };
    const contextFlag = contextFlags[context] || contextFlags.twitch;
    const speakerDisplayName = displayName?.trim() || username;
    const discordMetadata = [
      `Discord identity: username=${username};`,
      `displayName=${displayName || 'none'};`,
      `userId=${userId || 'unknown'};`,
      guildId ? `guildId=${guildId};` : '',
      guildName ? `guildName=${guildName};` : '',
      channelId ? `channelId=${channelId};` : '',
      channelName ? `channelName=${channelName};` : '',
      channelType !== undefined && channelType !== null ? `channelType=${String(channelType)};` : '',
      messageId ? `messageId=${messageId};` : '',
      createdAt ? `createdAt=${createdAt};` : '',
      `isDirectMessage=${isDirectMessage ? 'true' : 'false'};`,
    ].filter(Boolean).join(' ');

    const promptParts = [
      extendedGuidance,
      worldLoreText,
      botInteractionHistory,
      commanderContext,
      contextFlag,
      discordMetadata,
      historyText,
      research.kind === 'research' ? research.context : '',
      `Latest message from ${userIsCommander ? 'the Commander (M.T.)' : speakerDisplayName}: ${message}`,
      'Important: use the exact Discord identity context above. Do not rename the user to M.T. unless the Discord username itself belongs to the Commander.',
      `Respond as ${botResponseName}:`,
    ].filter(Boolean);

    const prompt = promptParts.join('\n\n');

    const userEntry = {
      type: 'user' as const,
      username,
      displayName: displayName || undefined,
      userId: userId || undefined,
      message,
      timestamp: new Date().toISOString(),
    };

    if (VERBOSE_LOGS) console.log('[AI Chat Memory] Saving user message:', userEntry);
    await appendPublicChatMessages([userEntry], 100, tenantId);

    // Use EdenAI API with proper system/user role separation
    const response = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${edenaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
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

    if (VERBOSE_LOGS) console.log('[AI Chat Memory] Saving AI response:', aiEntry);
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

    if (VERBOSE_LOGS) console.log('[AI Chat Memory] Successfully saved messages to public chat file');
    return apiOk({
      response: cleanResponse,
      research: research.kind === 'research'
        ? { state: 'completed', query: research.query, sources: research.sources }
        : undefined,
    });
  } catch (error) {
    console.error('[AI Chat Memory] API error:', error);
    return apiError('Failed to generate AI response with memory', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
