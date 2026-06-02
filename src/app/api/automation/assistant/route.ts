import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
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
  if (text === 'update-points') return SubActionType.MATH_OPERATION;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : SubActionType.SEND_MESSAGE;
}

function inferCommandLabel(message: string): string | null {
  const match = message.match(/!\w[\w-]*/);
  return match ? match[0] : null;
}

async function buildFallbackAutomation(message: string, selectedCommandId?: string | null, currentWorkflow?: any): Promise<AssistantAutomationResponse> {
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
  }

  return {
    assistantMessage: commandLabel
      ? `I drafted a simple workflow around ${commandLabel}. Add or confirm the command trigger, then review the action steps below.`
      : 'I drafted a starter workflow. Review the steps below and adjust the trigger before saving.',
    automation: {
      name: currentWorkflow?.name?.trim() || 'AI Drafted Workflow',
      triggers,
      subActions: [subAction],
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

  const fallback = await buildFallbackAutomation(message, selectedCommandId, currentWorkflow);
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

    const parsedResponse = extractJsonObject(responseText);
    if (!parsedResponse || typeof parsedResponse !== 'object') {
      return apiOk({
        ...fallback,
        assistantMessage: responseText.trim() || fallback.assistantMessage,
      });
    }

    const automation = parsedResponse.automation ?? fallback.automation;
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
