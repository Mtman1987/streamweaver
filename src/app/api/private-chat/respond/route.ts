import { NextRequest } from 'next/server';
import {
  appendPrivateChatMessages,
  readPrivateChatMessages,
  type PrivateChatMessage,
} from '@/lib/private-chat-store';
import { readPublicChatMessages } from '@/lib/public-chat-store';
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
import {
  QWEN_PRIVATE_CHAT_POLICY,
  requestQwenPrivateChatCompletion,
  sanitizeQwenReply,
} from '@/services/qwen-private-chat';
import { generateEdenAIFallbackResponse } from '@/services/ai-provider';
import {
  extractPrivateLtmDirective,
  isPrivateReplyRepetitive,
  prunePrivateChatHistoryLoops,
  shouldOfferPrivateLtm,
} from '@/services/private-chat-response-guard';
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

type PrivateCompletionResult = {
  text: string;
  provider: 'edenai-primary' | 'self-hosted-qwen-adult';
  error?: string;
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

function safeModelError(value: string | undefined): string {
  return String(value || 'The endpoint did not respond.')
    .replace(/https?:\/\/\S+/gi, '[model endpoint]')
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[a-z0-9_-]+/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function formatPrivateHistoryForFallback(history: PrivateChatMessage[], botName: string): string {
  const lines = history.slice(-20).map((entry) => {
    const role = entry.type === 'ai' ? botName : (entry.username || 'User');
    return `${role}: ${String(entry.message || '').trim()}`;
  }).filter((line) => !line.endsWith(': '));
  return lines.length ? `Recent private conversation:\n${lines.join('\n')}` : '';
}

function formatRecentPublicContext(messages: Array<{ type: 'user' | 'ai'; username: string; message: string }>, botName: string): string {
  if (!messages.length) return '';
  const lines = messages.slice(-12).map((entry) => {
    const role = entry.type === 'ai' ? botName : (entry.username || 'User');
    return `${role}: ${String(entry.message || '').trim()}`;
  }).filter((line) => !line.endsWith(': '));
  if (!lines.length) return '';
  return [
    'Recent public/shared context available to this private conversation:',
    lines.join('\n'),
    'This public context may inform the private reply. Never expose private history back into public chat.',
  ].join('\n');
}

async function completePrivateTurn(input: {
  baseUrl: string;
  model: string;
  apiKey: string;
  systemPrompt: string;
  username: string;
  botName: string;
  message: string;
  history: PrivateChatMessage[];
  memoryIndex?: string[];
  memoryContext?: string;
  adultMode: boolean;
  tenantId: string;
}): Promise<PrivateCompletionResult> {
  if (input.adultMode) {
    const qwen = await requestQwenPrivateChatCompletion({
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
      systemPrompt: input.systemPrompt,
      username: input.username,
      botName: input.botName,
      message: input.message,
      history: input.history,
      memoryIndex: input.memoryIndex,
      memoryContext: input.memoryContext,
      adultMode: true,
    });

    if (!qwen.upstreamStatus && !qwen.upstreamError && qwen.text.trim()) {
      return { text: qwen.text.trim(), provider: 'self-hosted-qwen-adult' };
    }

    const qwenError = safeModelError(
      qwen.upstreamError || (qwen.upstreamStatus ? `HTTP ${qwen.upstreamStatus}` : 'empty response'),
    );
    return {
      text: '',
      provider: 'self-hosted-qwen-adult',
      error: `Adult Mode local Qwen: ${qwenError}`,
    };
  }

  const edenSystem = [
    input.systemPrompt,
    QWEN_PRIVATE_CHAT_POLICY,
    input.memoryContext ? `Private memory context:\n${input.memoryContext}` : '',
  ].filter(Boolean).join('\n\n');
  const edenPrompt = [
    formatPrivateHistoryForFallback(input.history, input.botName),
    input.memoryIndex?.length ? `Available private memory titles: ${input.memoryIndex.join(' | ')}` : '',
    `Newest private message from ${input.username}: ${input.message}`,
    `Respond as ${input.botName}. Return only the assistant reply.`,
  ].filter(Boolean).join('\n\n');

  try {
    const rawPrimary = await generateEdenAIFallbackResponse(
      edenPrompt,
      edenSystem,
      input.tenantId,
      { maxTokens: 900, temperature: 0.7 },
    );
    const text = sanitizeQwenReply({
      text: rawPrimary,
      username: input.username,
      botName: input.botName,
      latestUserMessage: input.message,
    }).trim();
    if (!text) throw new Error('EdenAI returned an empty private reply.');
    return { text, provider: 'edenai-primary' };
  } catch (error) {
    const edenError = safeModelError(error instanceof Error ? error.message : String(error));
    console.warn('[Private Chat API] EdenAI private chat unavailable; local Qwen remains disabled because Adult Mode is off:', edenError);
    return {
      text: '',
      provider: 'edenai-primary',
      error: `EdenAI private chat: ${edenError}`,
    };
  }
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

async function savePrivateReply(tenantId: string, botName: string, responseText: string): Promise<void> {
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
    const publicHistory = await readPublicChatMessages(12, tenantId).catch(() => []);

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
            `${botName} will use the owner-hosted SPMT Qwen model with the adult private-chat policy.`,
            'EdenAI is not used while Adult Mode is on.',
            'This mode is only for fictional, consenting adults age 18 or older.',
          ].join(' ')
        : `Adult Mode is OFF. ${botName} will use EdenAI for private chat. Local Qwen is only used when Adult Mode is turned on.`;

      await savePrivateReply(tenantId, botName, responseText);
      return apiOk({ response: responseText, provider: 'private-chat-control', adultMode: effectiveMode });
    }

    const ltmTitles = await getPrivateLTMTitles(tenantId);
    const { systemIdentity, extendedGuidance } = buildPersonalityPrompt(botPersonality, privateSettings.adultMode);
    const governedSystemIdentity = [systemIdentity, privateSettings.adultMode ? '' : BOT_NO_SELF_PROMOTION_POLICY]
      .filter(Boolean)
      .join('\n\n');

    const qwenHistory = prunePrivateChatHistoryLoops(
      history.filter((entry) => !parseAdultModeCommand(entry.message, botName)),
    );
    const memoryIndexForTurn = shouldOfferPrivateLtm(message) ? ltmTitles : [];
    const qwenBaseUrl = getEffectiveQwenBaseUrl(privateSettings);
    const qwenModel = getEffectiveQwenModel(privateSettings);
    const qwenApiKey = process.env.PRIVATE_QWEN_API_KEY || '';
    const publicContext = formatRecentPublicContext(publicHistory as any, botName);
    const qwenSystemPrompt = [
      governedSystemIdentity,
      extendedGuidance,
      NATURAL_DIALOGUE_POLICY,
      publicContext,
    ].filter(Boolean).join('\n\n');

    let completion = await completePrivateTurn({
      baseUrl: qwenBaseUrl,
      model: qwenModel,
      apiKey: qwenApiKey,
      systemPrompt: qwenSystemPrompt,
      username,
      botName,
      message,
      history: qwenHistory,
      memoryIndex: memoryIndexForTurn.length ? memoryIndexForTurn : undefined,
      adultMode: privateSettings.adultMode,
      tenantId,
    });

    if (!completion.text) {
      const responseText = [
        privateSettings.adultMode
          ? `The owner-hosted SPMT Adult Mode model is unavailable for ${botName} right now.`
          : `EdenAI is unavailable for ${botName} private chat right now.`,
        safeModelError(completion.error),
      ].join(' ');
      await savePrivateReply(tenantId, botName, responseText);
      return apiOk({ response: responseText, provider: 'ai-unavailable', adultMode: privateSettings.adultMode });
    }

    let responseText = completion.text;
    const ltmDirective = extractPrivateLtmDirective(responseText);
    if (ltmDirective) {
      const canonicalTitle = memoryIndexForTurn.find(
        (title) => title.trim().toLowerCase() === ltmDirective.title.trim().toLowerCase(),
      );

      if (!canonicalTitle) {
        console.warn('[Private Chat] Ignoring unsolicited LTM request:', ltmDirective.title);
        responseText = ltmDirective.visibleText;
      } else {
        try {
          const ltmContent = await retrieveLTMByTitle(canonicalTitle, tenantId);
          if (ltmContent) {
            completion = await completePrivateTurn({
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
              tenantId,
            });
            responseText = completion.text || 'I found the memory, but the selected private AI provider failed to complete the reply.';
          } else {
            responseText = `I tried to recall "${canonicalTitle}" but that memory seems to have faded. Could you remind me what it was about?`;
          }
        } catch (error) {
          console.error('[Private Chat] Failed to retrieve LTM:', error);
          responseText = 'I had trouble accessing that memory. Could you remind me what you were referring to?';
        }
      }
    }

    const trailingDirective = extractPrivateLtmDirective(responseText);
    if (trailingDirective) {
      console.warn('[Private Chat] Stripped LTM directive from final reply:', trailingDirective.title);
      responseText = trailingDirective.visibleText;
    }

    if (!responseText || isPrivateReplyRepetitive(responseText, qwenHistory)) {
      console.warn('[Private Chat] Blocking repetitive private reply before save/send; requesting clean recovery turn.');
      const recoverySystemPrompt = [
        qwenSystemPrompt,
        'REPETITION RECOVERY: The previous candidate was blocked because it repeated a recent assistant turn or an old memory. Answer only the newest user message. Use a genuinely different opening, actions, imagery, sentence structure, and closing. Do not mention old memory titles or reuse an earlier scene unless the user explicitly asked to recall it.',
      ].join('\n\n');

      const recovery = await completePrivateTurn({
        baseUrl: qwenBaseUrl,
        model: qwenModel,
        apiKey: qwenApiKey,
        systemPrompt: recoverySystemPrompt,
        username,
        botName,
        message,
        history: qwenHistory,
        adultMode: privateSettings.adultMode,
        tenantId,
      });
      const recoveryDirective = extractPrivateLtmDirective(recovery.text);
      const recoveryText = (recoveryDirective?.visibleText || recovery.text || '').trim();

      if (recoveryText && !isPrivateReplyRepetitive(recoveryText, qwenHistory)) {
        responseText = recoveryText;
        completion = recovery;
      } else {
        responseText = `${botName} caught a repetition loop and blocked the duplicate instead of sending it again. Send your last line once more and I will answer from that point.`;
      }
    }

    if (!responseText) responseText = `${botName} returned an empty private reply.`;

    await savePrivateReply(tenantId, botName, responseText);
    return apiOk({
      response: responseText,
      provider: completion.provider,
      adultMode: privateSettings.adultMode,
      ttsEnabled: privateSettings.ttsEnabled,
      gifEnabled: privateSettings.gifEnabled,
    });
  } catch (error) {
    console.error('Private chat respond API error:', error);
    return apiError('Failed to generate private chat response', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
