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
import { requestQwenPrivateChatCompletion } from '@/services/qwen-private-chat';
import { attachPrivateDmControls, resolvePrivateDmMediaUrl, splitPrivateTtsText } from '@/services/private-dm-controls';
import { generateTTS } from '@/services/tts-provider';
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
import {
  buildPersonalityPrompt,
  NATURAL_DIALOGUE_POLICY,
} from '@/lib/personality-prompt';

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
      } else {
        console.error('[Private LTM] Condense request failed:', response.status);
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
      const responseText = effectiveMode
        ? [
            'Adult Mode is ON for private DMs.',
            'Athena will keep using the built-in SPMT Qwen model with the adult private-chat policy.',
            'This mode is only for fictional, consenting adults age 18 or older.',
          ].join(' ')
        : 'Adult Mode is OFF. Athena will keep using the built-in SPMT Qwen model with the normal private-chat policy.';

      await savePrivateReply(tenantId, botName, responseText);
      return apiOk({
        response: responseText,
        provider: 'private-chat-control',
        adultMode: effectiveMode,
      });
    }

    const ltmTitles = await getPrivateLTMTitles(tenantId);
    const { systemIdentity, extendedGuidance } = buildPersonalityPrompt(
      botPersonality,
      privateSettings.adultMode,
    );
    const governedSystemIdentity = [systemIdentity, privateSettings.adultMode ? '' : BOT_NO_SELF_PROMOTION_POLICY]
      .filter(Boolean)
      .join('\n\n');

    const qwenHistory = history.filter((entry) => !parseAdultModeCommand(entry.message, botName));
    const qwenBaseUrl = getEffectiveQwenBaseUrl(privateSettings);
    const qwenModel = getEffectiveQwenModel(privateSettings);
    const qwenApiKey = process.env.PRIVATE_QWEN_API_KEY || '';
    const qwenSystemPrompt = [
      governedSystemIdentity,
      extendedGuidance,
      NATURAL_DIALOGUE_POLICY,
    ].filter(Boolean).join('\n\n');

    let completion = await requestQwenPrivateChatCompletion({
      baseUrl: qwenBaseUrl,
      model: qwenModel,
      apiKey: qwenApiKey,
      systemPrompt: qwenSystemPrompt,
      username,
      botName,
      message,
      history: qwenHistory,
      memoryIndex: ltmTitles,
      adultMode: privateSettings.adultMode,
    });

    if (completion.upstreamStatus || completion.upstreamError) {
      console.error('[Private Chat API] Built-in Qwen error:', completion.upstreamStatus || null, completion.upstreamError);
      const responseText = [
        'The built-in SPMT Qwen model is unavailable right now.',
        safeQwenError(completion.upstreamError),
      ].join(' ');
      await savePrivateReply(tenantId, botName, responseText);
      return apiOk({
        response: responseText,
        provider: 'self-hosted-qwen-unavailable',
        adultMode: privateSettings.adultMode,
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
            systemPrompt: qwenSystemPrompt,
            username,
            botName,
            message,
            history: qwenHistory,
            memoryContext: ltmContent,
            adultMode: privateSettings.adultMode,
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
      responseText = 'Qwen returned an empty private reply.';
    }

    await savePrivateReply(tenantId, botName, responseText);
    return apiOk({
      response: responseText,
      provider: 'self-hosted-qwen',
      adultMode: privateSettings.adultMode,
      ttsEnabled: privateSettings.ttsEnabled,
      gifEnabled: privateSettings.gifEnabled,
    });
  } catch (error) {
    console.error('Private chat respond API error:', error);
    return apiError('Failed to generate private chat response', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
