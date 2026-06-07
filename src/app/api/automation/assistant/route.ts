import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getInternalAppUrl } from '@/lib/runtime-origin';
import { generateAIResponse, getAIConfig } from '@/services/ai-provider';
import { generateFlowNode } from '@/ai/flows/generate-flow-node';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';
import { SubActionType, TriggerType } from '@/services/automation/types';

const assistantSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  selectedCommandId: z.string().trim().max(128).optional().nullable(),
  currentWorkflow: z
    .object({
      name: z.string().optional(),
      triggers: z.array(z.any()).optional(),
      subActions: z.array(z.any()).optional(),
    })
    .optional(),
  tenantId: z.string().trim().max(128).optional(),
  userName: z.string().trim().max(128).optional(),
});

type AssistantAutomationResponse = {
  assistantMessage: string;
  automation?: {
    name: string;
    triggers: any[];
    subActions: any[];
    command?: {
      name?: string;
      command: string;
    };
  };
  codeSnippets?: Array<{ language: string; code: string; description: string }>;
  suggestedChanges?: string[];
};

function newId(): string {
  return randomUUID();
}

function asWorkflowArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizeTriggerType(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim().toLowerCase();
  if (text === 'command' || text === 'chat-command') return TriggerType.COMMAND;
  if (text === 'chat' || text === 'chat-message' || text === 'chat_message') return TriggerType.CHAT_MESSAGE;
  if (text === 'follow') return TriggerType.FOLLOW;
  if (text === 'cheer') return TriggerType.CHEER;
  if (text === 'subscribe') return TriggerType.SUBSCRIBE;
  if (text === 'resub') return TriggerType.RESUB;
  if (text === 'gift-sub') return TriggerType.GIFT_SUB;
  if (text === 'gift-bomb') return TriggerType.GIFT_BOMB;
  if (text === 'raid') return TriggerType.RAID;
  if (text === 'channel-point-reward') return TriggerType.CHANNEL_POINT_REWARD;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : TriggerType.COMMAND;
}

function normalizeSubActionType(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim().toLowerCase();
  if (text === 'send-chat' || text === 'send_message') return SubActionType.SEND_MESSAGE;
  if (text === 'send-discord') return SubActionType.DISCORD_SEND_MESSAGE;
  if (text === 'wait' || text === 'delay') return SubActionType.WAIT;
  if (text === 'if-else' || text === 'condition') return SubActionType.IF_ELSE;
  if (text === 'run-action') return SubActionType.RUN_ACTION;
  if (text === 'action-state') return SubActionType.ACTION_STATE;
  if (text === 'set-global-var') return SubActionType.SET_GLOBAL_VAR;
  if (text === 'get-global-var') return SubActionType.GET_GLOBAL_VAR;
  if (text === 'set-argument') return SubActionType.SET_ARGUMENT;
  if (text === 'set-user-var') return SubActionType.SET_USER_VAR;
  if (text === 'get-user-var') return SubActionType.GET_USER_VAR;
  if (text === 'math-operation') return SubActionType.MATH_OPERATION;
  if (text === 'string-operation') return SubActionType.STRING_OPERATION;
  if (text === 'http-request' || text === 'http_request') return SubActionType.HTTP_REQUEST;
  if (
    text === 'voice-reply' ||
    text === 'voice_reply' ||
    text === 'voice-reply-prompt' ||
    text === 'voice_reply_prompt' ||
    text === 'private-voice-reply'
  ) return SubActionType.VOICE_REPLY_PROMPT;
  if (text === 'update-points') return SubActionType.MATH_OPERATION;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : SubActionType.SEND_MESSAGE;
}

function inferCommandLabel(message: string): string | null {
  const match = message.match(/!\w[\w-]*/);
  return match ? match[0] : null;
}

function isRpsChallengePrompt(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('rock') && lower.includes('paper') && lower.includes('scissors')
  ) || lower.includes('best 2 out of 3') || lower.includes('best of 3') || lower.includes('rps');
}

function isVoiceReplyPrompt(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    (lower.includes('tts') || lower.includes('read') || lower.includes('read chat')) &&
    (lower.includes('stt') || lower.includes('speech to text') || lower.includes('speech-to-text') || lower.includes('transcrib')) &&
    (lower.includes('record') || lower.includes('recording') || lower.includes('microphone') || lower.includes('mic')) &&
    (lower.includes('chat') || lower.includes('message'))
  );
}

function isCodePrompt(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('generate code') ||
    lower.includes('write code') ||
    lower.includes('create code') ||
    lower.includes('code for') ||
    lower.includes('c# code') ||
    lower.includes('javascript code') ||
    lower.includes('python code')
  );
}

function buildVoiceReplyAutomationDraft(message: string, currentWorkflow?: any): AssistantAutomationResponse {
  const wantsManual = /\bmanual\b|\bturn off automatic\b|\bauto(?:matic)? reply off\b|\blet me\b/i.test(message);
  const triggers = asWorkflowArray(currentWorkflow?.triggers);
  const hasChatTrigger = triggers.some((trigger: any) => Number(trigger?.type) === TriggerType.CHAT_MESSAGE);
  const nextTriggers = hasChatTrigger
    ? triggers
    : [
        ...triggers,
        {
          id: newId(),
          type: TriggerType.CHAT_MESSAGE,
          enabled: true,
          exclusions: [],
          pattern: '.+',
          excludeBots: true,
        },
      ];

  return {
    assistantMessage: 'I drafted a browser-assisted voice reply workflow. Keep the Voice Reply page open while streaming; it handles private TTS, the ding, microphone recording, STT, and either automatic or manual sending.',
    automation: {
      name: currentWorkflow?.name?.trim() || 'Private Chat Voice Reply',
      triggers: nextTriggers,
      subActions: [
        {
          id: newId(),
          type: SubActionType.VOICE_REPLY_PROMPT,
          enabled: true,
          weight: 0,
          index: 0,
          readbackTemplate: '%userName% said %message%',
          waitMs: 5000,
          recordMs: 10000,
          autoSend: !wantsManual,
          useBot: true,
        },
      ],
    },
    suggestedChanges: [
      'Open the Voice Reply page before going live and grant microphone permission.',
      'Use Dashboard audio routing to choose the private TTS output device.',
      wantsManual ? 'Automatic Send is off, so transcriptions wait for approval.' : 'Turn Automatic Send off in the step or Voice Reply page if you want manual approval.',
    ],
  };
}

function buildCodeFallback(message: string): AssistantAutomationResponse {
  const lower = message.toLowerCase();
  const language = lower.includes('c#') ? 'csharp' : lower.includes('python') ? 'python' : 'javascript';
  const wantsTime = lower.includes('time') || lower.includes('date');
  const code =
    language === 'csharp'
      ? wantsTime
        ? 'using System;\n\npublic class CPHInline\n{\n    public bool Execute()\n    {\n        CPH.SetArgument("currentTime", DateTime.Now.ToString("h:mm tt"));\n        return true;\n    }\n}'
        : '// Add your Streamer.bot C# logic here.\nreturn true;'
      : language === 'python'
        ? wantsTime
          ? 'from datetime import datetime\n\ncurrent_time = datetime.now().strftime("%I:%M %p")\nprint(current_time)'
          : '# Add your automation logic here\nprint("done")'
        : wantsTime
          ? 'const currentTime = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });\nreturn currentTime;'
          : 'return "done";';

  return {
    assistantMessage: 'I drafted a code snippet. Review it before using it in a live command.',
    codeSnippets: [
      {
        language,
        code,
        description: wantsTime ? 'Gets the current local time.' : 'Starter automation snippet.',
      },
    ],
    suggestedChanges: ['Test the snippet with a manual run before attaching it to a live command.'],
  };
}

function buildRpsAutomationDraft(message: string, selectedCommandId?: string | null, currentWorkflow?: any): AssistantAutomationResponse {
  const commandLabel = inferCommandLabel(message) || '!rps';
  const triggers = [...asWorkflowArray(currentWorkflow?.triggers)];
  if (selectedCommandId && !triggers.some((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND)) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      commandId: selectedCommandId,
    });
  } else if (!selectedCommandId && !triggers.some((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND)) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      command: commandLabel,
    });
  }

  if (!triggers.some((trigger: any) => Number(trigger?.type) === TriggerType.CHAT_MESSAGE)) {
    triggers.push({
      id: newId(),
      type: TriggerType.CHAT_MESSAGE,
      enabled: true,
      exclusions: [],
      pattern: '^(rock|paper|scissors)$',
      excludeBots: true,
    });
  }

  const httpUrl = `${getInternalAppUrl()}/api/automation/challenge/rps`;
  const subActions = [
    {
      id: newId(),
      type: SubActionType.HTTP_REQUEST,
      enabled: true,
      weight: 0,
      index: 0,
      url: httpUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user: '%user%',
        message: '%message%',
        rawInput: '%rawInput%',
        channel: '%channel%',
        tenantId: '%tenantId%',
      }),
      parseAsJson: true,
      variableName: 'rpsChallengeResult',
    },
  ];

  return {
    assistantMessage: selectedCommandId
      ? 'I drafted a stateful RPS automation that uses a command trigger plus a chat-response trigger. The actual game resolution runs in StreamWeaver, so it can handle rounds, score, and points without me faking the result.'
      : 'I drafted the RPS automation logic, but you still need to attach the command trigger for !rps before saving. The game resolution itself runs inside StreamWeaver, so it can handle rounds, score, and points without me faking the result.',
    automation: {
      name: currentWorkflow?.name?.trim() || 'RPS Challenge',
      triggers,
      subActions,
      ...(!selectedCommandId ? { command: { name: commandLabel.replace(/^!/, ''), command: commandLabel } } : {}),
    },
    suggestedChanges: selectedCommandId
      ? ['Review the chat pattern if you want to accept other spellings.', 'Check the point bet behavior before saving.']
      : ['Select the !rps command trigger before saving.', 'Review the chat pattern if you want to accept other spellings.'],
  };
}

async function buildFallbackAutomation(message: string, selectedCommandId?: string | null, currentWorkflow?: any): Promise<AssistantAutomationResponse> {
  if (isVoiceReplyPrompt(message)) {
    return buildVoiceReplyAutomationDraft(message, currentWorkflow);
  }

  if (isRpsChallengePrompt(message)) {
    return buildRpsAutomationDraft(message, selectedCommandId, currentWorkflow);
  }

  const commandLabel = inferCommandLabel(message);
  const node = await generateFlowNode({
    description: message,
    context: {
      defaultVoice: process.env.NEXT_DEFAULT_TTS_VOICE,
    },
  });

  const subAction = nodeToSubAction(node, 0);
  const triggers = asWorkflowArray(currentWorkflow?.triggers);
  const hasCommandTrigger = triggers.some((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND);

  if (!hasCommandTrigger && selectedCommandId) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      commandId: selectedCommandId,
    });
  } else if (!hasCommandTrigger && commandLabel) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      command: commandLabel,
    });
  }

  return {
    assistantMessage: commandLabel
      ? `I drafted a simple workflow around ${commandLabel}. Add or confirm the command trigger, then review the action steps below.`
      : 'I drafted a starter workflow. Review the steps below and adjust the trigger before saving.',
    automation: {
      name: currentWorkflow?.name?.trim() || 'AI Drafted Workflow',
      triggers,
      subActions: [subAction],
      ...(!selectedCommandId && commandLabel ? { command: { name: commandLabel.replace(/^!/, ''), command: commandLabel } } : {}),
    },
    suggestedChanges: ['Review the trigger and adjust the response text before saving.'],
  };
}

function nodeToSubAction(node: any, index: number) {
  const subtype = String(node?.subtype || '');
  if (subtype === 'send-chat') {
    return {
      id: newId(),
      type: SubActionType.SEND_MESSAGE,
      enabled: true,
      weight: 0,
      index,
      text: String(node?.data?.message || ''),
      useBot: String(node?.data?.as || 'broadcaster') === 'bot',
    };
  }

  if (subtype === 'send-discord') {
    return {
      id: newId(),
      type: SubActionType.DISCORD_SEND_MESSAGE,
      enabled: true,
      weight: 0,
      index,
      text: String(node?.data?.message || ''),
      channelId: String(node?.data?.channelId || ''),
    };
  }

  if (subtype === 'delay') {
    return {
      id: newId(),
      type: SubActionType.WAIT,
      enabled: true,
      weight: 0,
      index,
      minValue: Number(node?.data?.seconds || 0) * 1000 || 1000,
      maxValue: Number(node?.data?.seconds || 0) * 1000 || 1000,
    };
  }

  if (subtype === 'update-points') {
    return {
      id: newId(),
      type: SubActionType.MATH_OPERATION,
      enabled: true,
      weight: 0,
      index,
      variableName: 'pointsResult',
      operand1: String(node?.data?.amount ?? 0),
      operand2: '0',
      operation: String(node?.data?.operation || 'add'),
    };
  }

  return {
    id: newId(),
    type: SubActionType.SEND_MESSAGE,
    enabled: true,
    weight: 0,
    index,
    text: String(node?.label || 'AI draft'),
  };
}

function extractJsonObject(text: string): any | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {}
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const parsed = assistantSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Message is required.', { status: 400, code: 'INVALID_BODY' });
    }

    const { message, selectedCommandId, currentWorkflow, tenantId, userName } = parsed.data;
    const aiConfig = getAIConfig(tenantId);

    const fallback = isCodePrompt(message)
      ? buildCodeFallback(message)
      : await buildFallbackAutomation(message, selectedCommandId, currentWorkflow);
    if (isVoiceReplyPrompt(message)) {
      return apiOk(fallback);
    }
    const prompt = [
      'You are StreamWeaver AI Automation Assistant.',
      'Return strict JSON only, no markdown fences.',
      'Schema:',
      '{',
      '  "assistantMessage": string,',
      '  "automation": {',
      '    "name": string,',
      '    "triggers": Array<object>,',
      '    "subActions": Array<object>',
      '  },',
      '  "codeSnippets": Array<{ "language": string, "code": string, "description": string }>,',
      '  "suggestedChanges": string[]',
      '}',
      'Use StreamWeaver automation objects, prefer simple valid steps, and keep the workflow user-friendly.',
      `User: ${userName || 'User'}`,
      `Selected command id: ${selectedCommandId || 'none'}`,
      `Current workflow: ${JSON.stringify({
        name: currentWorkflow?.name || '',
        triggers: currentWorkflow?.triggers || [],
        subActions: currentWorkflow?.subActions || [],
      })}`,
      `Request: ${message}`,
      'If the request is ambiguous, still provide a best-effort draft automation and a short explanation.',
    ].join('\n');

    if (!aiConfig.apiKey) {
      return apiOk(fallback);
    }

    let responseText = '';
    try {
      responseText = await generateAIResponse(prompt, 'You are a concise automation planner.', tenantId);
    } catch (error) {
      console.warn('[Automation Assistant] AI generation failed, using fallback:', error);
      return apiOk(fallback);
    }

    if (!responseText.trim() || responseText.trim() === 'AI response failed') {
      return apiOk(fallback);
    }

    const parsedResponse = extractJsonObject(responseText);
    if (!parsedResponse || typeof parsedResponse !== 'object') {
      return apiOk({
        ...fallback,
        assistantMessage: responseText.trim() || fallback.assistantMessage,
      });
    }

    const automation = parsedResponse.automation ?? fallback.automation;
    const commandLabel = inferCommandLabel(message);
    const nextTriggers = asWorkflowArray(automation?.triggers).map((trigger) => ({
      ...trigger,
      id: String(trigger?.id || newId()),
      type: normalizeTriggerType(trigger?.type),
      enabled: trigger?.enabled ?? true,
      exclusions: Array.isArray(trigger?.exclusions) ? trigger.exclusions : [],
    }));
    if (selectedCommandId && !nextTriggers.some((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND)) {
      nextTriggers.unshift({
        id: newId(),
        type: TriggerType.COMMAND,
        enabled: true,
        exclusions: [],
        commandId: selectedCommandId,
      });
    } else if (!selectedCommandId && commandLabel) {
      const commandTriggerIndex = nextTriggers.findIndex((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND);
      if (commandTriggerIndex >= 0) {
        nextTriggers[commandTriggerIndex] = {
          ...nextTriggers[commandTriggerIndex],
          command: nextTriggers[commandTriggerIndex]?.command || commandLabel,
        };
      } else {
        nextTriggers.unshift({
          id: newId(),
          type: TriggerType.COMMAND,
          enabled: true,
          exclusions: [],
          command: commandLabel,
        });
      }
    }

    const nextSubActions = asWorkflowArray(automation?.subActions).map((subAction, index) => ({
      ...subAction,
      id: String(subAction?.id || newId()),
      type: normalizeSubActionType(subAction?.type),
      enabled: subAction?.enabled ?? true,
      weight: Number(subAction?.weight ?? 0),
      index: Number(subAction?.index ?? index),
    }));

    return apiOk({
      assistantMessage: String(parsedResponse.assistantMessage || fallback.assistantMessage),
      automation: {
        name: String(automation?.name || fallback.automation?.name || 'AI Drafted Workflow'),
        triggers: nextTriggers,
        subActions: nextSubActions.length > 0 ? nextSubActions : fallback.automation?.subActions || [],
        ...(automation?.command || fallback.automation?.command || commandLabel
          ? {
              command: automation?.command ||
                fallback.automation?.command || {
                  name: commandLabel?.replace(/^!/, '') || 'AI Command',
                  command: commandLabel,
                },
            }
          : {}),
      },
      codeSnippets: Array.isArray(parsedResponse.codeSnippets) ? parsedResponse.codeSnippets : fallback.codeSnippets || [],
      suggestedChanges: Array.isArray(parsedResponse.suggestedChanges)
        ? parsedResponse.suggestedChanges
        : fallback.suggestedChanges || [],
    });
  } catch (error: any) {
    console.error('[Automation Assistant] Error:', error);
    return apiError(error?.message || 'Failed to generate automation draft.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
