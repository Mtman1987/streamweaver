import { NextRequest } from 'next/server';
import {
  appendPrivateChatMessages,
  readPrivateChatMessages,
  type PrivateChatMessage,
} from '@/lib/private-chat-store';
import {
  getPrivateLTMTitles,
  incrementPrivateMessageCount,
  getPrivateMessageCount,
  retrieveLTMByTitle,
} from '@/lib/private-ltm-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getBotName, getBotPersonality } from '@/lib/bot-settings-store';
import { getInternalAppUrl } from '@/lib/runtime-origin';
import {
  hasInternalServiceAccess,
  hasMountainViewBridgeAccess,
  internalServiceHeaders,
} from '@/lib/internal-service-auth';
import { requestPrivateChatCompletion } from '@/services/private-chat-ai';
import { requestSeaArtCharacterCompletion } from '@/services/seaart-character-chat';
import { requestQwenPrivateChatCompletion } from '@/services/qwen-private-chat';
import { attachPrivateDmControls, resolvePrivateDmMediaUrl, splitPrivateTtsText } from '@/services/private-dm-controls';
import { generateTTS } from '@/services/tts-provider';
import { readGenerationSettings } from '@/lib/gen-settings-store';
import {
  applyAdultModeAction,
  getEffectiveQwenBaseUrl,
  getEffectiveQwenModel,
  parseAdultModeCommand,
  readPrivateChatSettings,
  writePrivateChatSettings,
} from '@/lib/private-chat-settings-store';
import { z } from 'zod';
import { BOT_NO_SELF_PROMOTION_POLICY } from '@/lib/bot-conduct-policy';

type RequestBody = {
  username: string;
  message: string;
  attachments?: PrivateChatMessage['attachments'];
  embeds?: PrivateChatMessage['embeds'];
  personality?: string;
  historyLimit?: number;
  tenantId?: string;
};

type CompletionResult = {
  text: string;
  provider?: string;
  filtered?: boolean;
  upstreamStatus?: number;
  upstreamError?: string;
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

  const lines = messages.map((entry) => {
    const role = entry.type === 'ai' ? (entry.username || 'AI') : (entry.username || 'User');
    const mediaCount = (entry.attachments?.length || 0) + (entry.embeds?.length || 0);
    const mediaNote = mediaCount ? ` [${mediaCount} media item${mediaCount === 1 ? '' : 's'}]` : '';
    return `${role}: ${entry.message}${mediaNote}`;
  });

  return `Conversation so far:\n${lines.join('\n')}`;
}

function splitPersonality(rawPersonality: string): { systemIdentity: string; extendedGuidance: string } {
  if (rawPersonality.includes('\n---\n') || rawPersonality.includes('\n---')) {
    const splitIndex = rawPersonality.indexOf('\n---');
    return {
      systemIdentity: rawPersonality.substring(0, splitIndex).trim(),
      extendedGuidance: rawPersonality.substring(splitIndex).replace(/^\n---\n?/, '').trim(),
    };
  }
  return { systemIdentity: rawPersonality, extendedGuidance: '' };
}

function safeQwenError(value: string | undefined): string {
  return String(value || 'The endpoint did not respond.')
    .replace(/https?:\/\/\S+/gi, '[Qwen endpoint]')
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[a-z0-9_-]+/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
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

async function savePrivateReply(
  tenantId: string,
  botName: string,
  responseText: string,
): Promise<void> {
  await appendPrivateChatMessages([{
    type: 'ai',
    username: botName,
    message: responseText,
    timestamp: new Date().toISOString(),
  }], 100, tenantId);
}

export async function POST(request: NextRequest) {
  if (VERBOSE_LOGS) console.log('[Private Chat API] POST request received');

  try {
    const parsed = privateRespondSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Missing required fields: username, message', {
        status: 400,
        code: 'INVALID_BODY',
      });
    }

    const {
      username,
      message,
      attachments,
      embeds,
      historyLimit,
      tenantId: bodyTenantId,
    } = parsed.data as RequestBody;
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
    const privateSettings = await readPrivateChatSettings(tenantId);
    const adultModeAction = parseAdultModeCommand(message, botName);

    await incrementPrivateMessageCount(tenantId);
    await checkAndCondensePrivateMemory(tenantId);
    const history = await readPrivateChatMessages(historyLimit, tenantId);

    const userEntry: PrivateChatMessage = {
      type: 'user',
      username,
      message,
      timestamp: new Date().toISOString(),
      attachments,
      embeds,
    };
    await appendPrivateChatMessages([userEntry], 100, tenantId);

    if (adultModeAction) {
      const adultMode = applyAdultModeAction(privateSettings.adultMode, adultModeAction);
      const saved = adultModeAction === 'status'
        ? privateSettings
        : await writePrivateChatSettings({ adultMode }, tenantId);
      const effectiveMode = adultModeAction === 'status' ? privateSettings.adultMode : saved.adultMode;
      const endpointConfigured = Boolean(getEffectiveQwenBaseUrl(saved));
      const modelConfigured = Boolean(getEffectiveQwenModel(saved));
      const responseText = effectiveMode
        ? [
            'Adult Mode is ON for private DMs.',
            endpointConfigured && modelConfigured
              ? 'Athena will use only our configured Qwen endpoint.'
              : 'The Qwen endpoint or model still needs to be configured on the Private Chat page.',
            'If Qwen is unavailable, the request stops there and no cloud fallback is used.',
            'This mode is only for fictional, consenting adults age 18 or older.',
          ].join(' ')
        : 'Adult Mode is OFF. Private DMs will use the normal configured Athena provider.';

      await savePrivateReply(tenantId, botName, responseText);
      return apiOk({
        response: responseText,
        provider: 'private-chat-control',
        adultMode: effectiveMode,
      });
    }

    const ltmTitles = await getPrivateLTMTitles(tenantId);
    const { systemIdentity, extendedGuidance } = splitPersonality(botPersonality);
    const adultFilteredIdentity = privateSettings.adultMode
      ? systemIdentity
          .split(/(?<=[.!?])\s+|\n/)
          .filter((s) => !/\b(family[- ]friendly|family[- ]safe|safe[- ]for[- ]work|\bsfw\b|no adult|no explicit|no mature|keep it clean|stay clean|appropriate for all|all ages|child[- ]friendly|not explicit|not mature|avoid explicit|avoid adult|avoid mature|pg[- ]?1?3?[- ]?rated?|keep.*appropriate|appropriate.*all)\b/i.test(s))
          .join(' ')
          .trim()
      : systemIdentity;
    const governedSystemIdentity = [adultFilteredIdentity, privateSettings.adultMode ? '' : BOT_NO_SELF_PROMOTION_POLICY]
      .filter(Boolean)
      .join('\n\n');

    if (privateSettings.adultMode) {
      const roleplayHistory = history.filter((entry) => !parseAdultModeCommand(entry.message, botName));
      const qwenBaseUrl = getEffectiveQwenBaseUrl(privateSettings);
      const qwenModel = getEffectiveQwenModel(privateSettings);
      const qwenApiKey = process.env.PRIVATE_QWEN_API_KEY || '';

      let completion = await requestQwenPrivateChatCompletion({
        baseUrl: qwenBaseUrl,
        model: qwenModel,
        apiKey: qwenApiKey,
        systemPrompt: governedSystemIdentity,
        username,
        botName,
        message,
        history: roleplayHistory,
        memoryIndex: ltmTitles,
      });

      if (completion.upstreamStatus || completion.upstreamError) {
        console.error('[Private Chat API] Self-hosted Qwen error:', completion.upstreamStatus || null, completion.upstreamError);
        const responseText = [
          'Adult Mode is on, but the private Qwen model is unavailable.',
          safeQwenError(completion.upstreamError),
          'No fallback provider received this message.',
        ].join(' ');
        await savePrivateReply(tenantId, botName, responseText);
        return apiOk({
          response: responseText,
          provider: 'self-hosted-qwen-unavailable',
          adultMode: true,
        });
      }

      let responseText = completion.text;
      const ltmRequestMatch = responseText.match(/^\s*LTM_REQUEST:\s*(.+?)\s*$/i);
      if (ltmRequestMatch) {
        const requestedTitle = ltmRequestMatch[1].trim();
        try {
          const ltmContent = await retrieveLTMByTitle(requestedTitle, tenantId);
          if (ltmContent) {
            completion = await requestQwenPrivateChatCompletion({
              baseUrl: qwenBaseUrl,
              model: qwenModel,
              apiKey: qwenApiKey,
              systemPrompt: governedSystemIdentity,
              username,
              botName,
              message,
              history: roleplayHistory,
              memoryContext: ltmContent,
            });
            responseText = completion.text || [
              'I found the memory, but Qwen could not complete the reply.',
              safeQwenError(completion.upstreamError),
            ].join(' ');
          } else {
            responseText = `I tried to recall "${requestedTitle}" but that memory seems to have faded. Could you remind me what it was about?`;
          }
        } catch (error) {
          console.error('[Private Chat] Failed to retrieve LTM for Qwen:', error);
          responseText = 'I had trouble accessing that memory. Could you remind me what you were referring to?';
        }
      }

      if (!responseText) {
        responseText = 'Qwen returned an empty private reply. No fallback provider was used.';
      }

      await savePrivateReply(tenantId, botName, responseText);
      return apiOk({
        response: responseText,
        provider: 'self-hosted-qwen',
        adultMode: true,
        ttsEnabled: privateSettings.ttsEnabled,
        gifEnabled: privateSettings.gifEnabled,
      });
    }

    const generationSettings = await readGenerationSettings(tenantId);
    const seaartCharacterId = generationSettings.seaartCharacterId;
    const seaartCharacterToken = process.env.SEAART_CHARACTER_TOKEN || process.env.SEAART_TOKEN || '';
    const useSeaArtCharacter = Boolean(seaartCharacterId);
    const edenaiKey = process.env.EDENAI_API_KEY || '';
    if (!useSeaArtCharacter && !edenaiKey) {
      return apiError('Server missing EdenAI API key', { status: 500, code: 'MISSING_CONFIG' });
    }

    const ltmContext = ltmTitles.length > 0
      ? `\n\nLong Term Memory titles (request full content if relevant): ${ltmTitles.join(', ')}`
      : '';
    const historyText = formatHistory(history);
    const privateContext = '[Context: This is a PRIVATE conversation with the broadcaster. Not on stream. You can speak freely, be more detailed, and discuss behind-the-scenes topics.]';
    const prompt = [
      extendedGuidance,
      privateContext,
      'If you need more context from Long Term Memory, respond with: "LTM_REQUEST: [exact title]" and I will provide the full content.',
      historyText,
      `Latest message from ${username}: ${message}${ltmContext}`,
      `Respond as ${botName}:`,
    ].filter(Boolean).join('\n\n');
    const reducedContextPrompt = [
      extendedGuidance,
      privateContext,
      `Latest message from ${username}: ${message}${ltmContext}`,
      `Respond as ${botName}:`,
    ].filter(Boolean).join('\n\n');

    let completion: CompletionResult = useSeaArtCharacter
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
          systemPrompt: governedSystemIdentity,
          prompt,
        });

    if (completion.filtered) {
      console.warn('[Private Chat API] Retrying filtered DM without older conversation history');
      completion = await requestPrivateChatCompletion({
        apiKey: edenaiKey,
        systemPrompt: governedSystemIdentity,
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
    const ltmRequestMatch = responseText.match(/LTM_REQUEST:\s*(.+)/);
    if (ltmRequestMatch) {
      const requestedTitle = ltmRequestMatch[1].trim();
      try {
        const ltmContent = await retrieveLTMByTitle(requestedTitle, tenantId);
        if (ltmContent) {
          const enhancedPrompt = `${prompt}\n\nLTM Content for "${requestedTitle}": ${ltmContent}\n\nNow respond as ${botName} (do not repeat the LTM content verbatim, use it naturally):`;
          const enhancedCompletion: CompletionResult = useSeaArtCharacter
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
                systemPrompt: governedSystemIdentity,
                prompt: enhancedPrompt,
              });
          responseText = enhancedCompletion.text || responseText;
        } else {
          responseText = `I tried to recall "${requestedTitle}" but that memory seems to have faded. Could you remind me what it was about?`;
        }
      } catch (error) {
        console.error('[Private Chat] Failed to retrieve LTM:', error);
        responseText = 'I had trouble accessing my memory. Could you remind me what you were referring to?';
      }
    }

    if (!responseText) {
      return apiError('AI returned an empty response', { status: 502, code: 'EMPTY_RESPONSE' });
    }

    await savePrivateReply(tenantId, botName, responseText);
    return apiOk({
      response: responseText,
      provider: useSeaArtCharacter ? 'seaart-character' : 'edenai',
      adultMode: false,
      ttsEnabled: privateSettings.ttsEnabled,
      gifEnabled: privateSettings.gifEnabled,
    });
  } catch (error) {
    console.error('Private chat respond API error:', error);
    return apiError('Failed to generate private chat response', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
