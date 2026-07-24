import { NextRequest, NextResponse } from 'next/server';
import {
  appendPrivateChatMessages,
  readPrivateChatMessages,
  type PrivateChatMessage,
} from '@/lib/private-chat-store';
import { getPrivateLTMTitles, incrementPrivateMessageCount, getPrivateMessageCount, retrieveLTMByTitle } from '@/lib/private-ltm-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getBotName, getBotPersonality } from '@/lib/bot-settings-store';
import { getInternalAppUrl } from '@/lib/runtime-origin';
import { hasInternalServiceAccess, hasMountainViewBridgeAccess, internalServiceHeaders } from '@/lib/internal-service-auth';
import { requestPrivateChatCompletion } from '@/services/private-chat-ai';
import { requestSeaArtCharacterCompletion } from '@/services/seaart-character-chat';
import { readGenerationSettings } from '@/lib/gen-settings-store';
import { z } from 'zod';

type RequestBody = {
  username: string;
  message: string;
  attachments?: PrivateChatMessage['attachments'];
  embeds?: PrivateChatMessage['embeds'];
  personality?: string;
  historyLimit?: number;
  tenantId?: string;
};

const VERBOSE_LOGS = process.env.STREAMWEAVER_VERBOSE_LOGS === 'true';

const privateRespondSchema = z.object({
  username: z.string().trim().min(1, 'username is required').max(128),
  message: z.string().trim().max(5000),
  attachments: z.array(z.object({
    id: z.string().optional(),
    url: z.string().trim().min(1),
    filename: z.string().optional(),
    content_type: z.string().optional(),
  }).passthrough()).optional(),
  embeds: z.array(z.object({}).passthrough()).optional(),
  personality: z.string().trim().max(3000).optional(),
  historyLimit: z.coerce.number().int().min(0).max(100).optional().default(20),
  tenantId: z.string().trim().max(128).optional(),
}).refine((value) => value.message || value.attachments?.length || value.embeds?.length, {
  message: 'message or media is required',
});

function formatHistory(messages: PrivateChatMessage[]): string {
  if (messages.length === 0) return '';

  const lines = messages.map((m) => {
    const role = m.type === 'ai' ? (m.username || 'AI') : (m.username || 'User');
    const mediaCount = (m.attachments?.length || 0) + (m.embeds?.length || 0);
    const mediaNote = mediaCount ? ` [${mediaCount} media item${mediaCount === 1 ? '' : 's'}]` : '';
    return `${role}: ${m.message}${mediaNote}`;
  });

  return `Conversation so far:\n${lines.join('\n')}`;
}

async function checkAndCondensePrivateMemory(tenantId?: string): Promise<void> {
  try {
    const messageCount = await getPrivateMessageCount(tenantId);
    if (messageCount > 0 && messageCount % 50 === 0) {
      console.log(`[Private LTM] Message count reached ${messageCount}, condensing history...`);
      
      const response = await fetch(`${getInternalAppUrl()}/api/private-ltm/condense`, {
        method: 'POST',
        headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tenantId }),
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
  if (VERBOSE_LOGS) console.log('[Private Chat API] POST request received');
  
  try {
    const parsed = privateRespondSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      console.log('[Private Chat API] Missing required fields');
      return apiError('Missing required fields: username, message', { status: 400, code: 'INVALID_BODY' });
    }

    const { username, message, attachments, embeds, personality, historyLimit, tenantId: bodyTenantId } = parsed.data as RequestBody;
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
    const botName = getBotName(tenantId);
    const botPersonality = getBotPersonality(tenantId);
    if (VERBOSE_LOGS) {
      console.log('[Private Chat API] Request body:', { username, messageLength: message.length, tenantId: tenantId || 'global', botName, personalitySnippet: botPersonality?.slice(0, 60) });
    }

    const generationSettings = await readGenerationSettings(tenantId);
    const seaartCharacterId = generationSettings.seaartCharacterId;
    const seaartCharacterToken = process.env.SEAART_CHARACTER_TOKEN || process.env.SEAART_TOKEN || '';
    const useSeaArtCharacter = Boolean(seaartCharacterId);
    const edenaiKey = process.env.EDENAI_API_KEY || '';
    if (!useSeaArtCharacter && !edenaiKey) {
      return apiError('Server missing EdenAI API key', { status: 500, code: 'MISSING_CONFIG' });
    }

    // Increment message count and check for LTM condensation
    const messageCount = await incrementPrivateMessageCount(tenantId);
    await checkAndCondensePrivateMemory(tenantId);

    const history = await readPrivateChatMessages(historyLimit, tenantId);

    // Get LTM titles for context
    const ltmTitles = await getPrivateLTMTitles(tenantId);
    const ltmContext = ltmTitles.length > 0 
      ? `\n\nLong Term Memory titles (request full content if relevant): ${ltmTitles.join(', ')}`
      : '';

    // Two-tier personality split — ALWAYS use server-side tenant personality (ignore client override)
    let systemIdentity: string;
    let extendedGuidance: string;
    const rawPersonality = botPersonality;
    if (rawPersonality.includes('\n---\n') || rawPersonality.includes('\n---')) {
      const splitIndex = rawPersonality.indexOf('\n---');
      systemIdentity = rawPersonality.substring(0, splitIndex).trim();
      extendedGuidance = rawPersonality.substring(splitIndex).replace(/^\n---\n?/, '').trim();
    } else {
      systemIdentity = rawPersonality;
      extendedGuidance = '';
    }

    const historyText = formatHistory(history);

    const promptParts = [
      extendedGuidance,
      '[Context: This is a PRIVATE conversation with the broadcaster. Not on stream. You can speak freely, be more detailed, and discuss behind-the-scenes topics.]',
      'If you need more context from Long Term Memory, respond with: "LTM_REQUEST: [exact title]" and I will provide the full content.',
      historyText,
      `Latest message from ${username}: ${message}${ltmContext}`,
      `Respond as ${botName}:`,
    ].filter(Boolean);

    const prompt = promptParts.join('\n\n');
    const reducedContextPrompt = [
      extendedGuidance,
      '[Context: This is a PRIVATE conversation with the broadcaster. Not on stream. You can speak freely, be more detailed, and discuss behind-the-scenes topics.]',
      `Latest message from ${username}: ${message}${ltmContext}`,
      `Respond as ${botName}:`,
    ].filter(Boolean).join('\n\n');

    const userEntry: PrivateChatMessage = {
      type: 'user',
      username,
      message,
      timestamp: new Date().toISOString(),
      attachments,
      embeds,
    };

    if (VERBOSE_LOGS) {
      console.log('[Private Chat API] Saving user message to tenant:', tenantId || 'NO TENANT - LEGACY PATH');
      console.log('[Private Chat API] File path:', (await import('@/lib/private-chat-store')).getPrivateChatFilePath(tenantId));
    }
    await appendPrivateChatMessages([userEntry], 100, tenantId);

    let completion = useSeaArtCharacter
      ? await requestSeaArtCharacterCompletion({
          token: seaartCharacterToken,
          tenantId,
          characterId: seaartCharacterId,
          message,
          history,
          characterName: botName,
        })
      : await requestPrivateChatCompletion({
          apiKey: edenaiKey,
          systemPrompt: systemIdentity,
          prompt,
        });

    if ('filtered' in completion && completion.filtered) {
      console.warn('[Private Chat API] Retrying filtered DM without older conversation history');
      completion = await requestPrivateChatCompletion({
        apiKey: edenaiKey,
        systemPrompt: systemIdentity,
        prompt: reducedContextPrompt,
      });
    }

    if (completion.upstreamStatus || completion.upstreamError) {
      const provider = useSeaArtCharacter ? 'SeaArt character' : 'EdenAI';
      console.error(`[Private Chat API] ${provider} error:`, completion.upstreamStatus || null, completion.upstreamError);
      return apiError(`${provider} API failed`, {
        status: 502,
        code: 'UPSTREAM_ERROR',
        details: { upstreamStatus: completion.upstreamStatus },
      });
    }

    let responseText = completion.text;

    // Handle LTM requests
    const ltmRequestMatch = responseText.match(/LTM_REQUEST:\s*(.+)/);
    if (ltmRequestMatch) {
      const requestedTitle = ltmRequestMatch[1].trim();
      
      try {
        const ltmContent = await retrieveLTMByTitle(requestedTitle, tenantId);
        
        if (ltmContent) {
          // Re-generate response with LTM content
          const enhancedPrompt = prompt + `\n\nLTM Content for "${requestedTitle}": ${ltmContent}\n\nNow respond as ${botName} (do not repeat the LTM content verbatim, use it naturally):`;
          
          const enhancedCompletion = useSeaArtCharacter
            ? await requestSeaArtCharacterCompletion({
                token: seaartCharacterToken,
                tenantId,
                characterId: seaartCharacterId,
                message: `${message}\n\nRelevant memory: ${ltmContent}`,
                history,
                characterName: botName,
              })
            : await requestPrivateChatCompletion({
                apiKey: edenaiKey,
                systemPrompt: systemIdentity,
                prompt: enhancedPrompt,
              });

          responseText = enhancedCompletion.text || responseText;
        } else {
          // No memory found — let AI know
          responseText = `I tried to recall "${requestedTitle}" but that memory seems to have faded. Could you remind me what it was about, Commander?`;
        }
      } catch (error) {
        console.error('[Private Chat] Failed to retrieve LTM:', error);
        responseText = 'I had trouble accessing my memory banks. Could you remind me what you were referring to?';
      }
    }

    if (!responseText) {
      console.log('[Private Chat API] AI returned empty response');
      return apiError('AI returned an empty response', { status: 502, code: 'EMPTY_RESPONSE' });
    }

    const aiEntry: PrivateChatMessage = {
      type: 'ai',
      username: botName,
      message: responseText,
      timestamp: new Date().toISOString(),
    };

    if (VERBOSE_LOGS) console.log('[Private Chat API] Saving AI response:', aiEntry);
    await appendPrivateChatMessages([aiEntry], 100, tenantId);

    if (VERBOSE_LOGS) console.log('[Private Chat API] Successfully saved both messages');
    return apiOk({ response: responseText, provider: useSeaArtCharacter ? 'seaart-character' : 'edenai' });
  } catch (error) {
    console.error('Private chat respond API error:', error);
    return apiError('Failed to generate private chat response', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
