import { randomUUID } from 'crypto';
import { getInternalAppUrl } from '@/lib/runtime-origin';
import { createAction, deleteAction, getAllActions, updateAction } from '@/lib/actions-store';
import { createCommand, deleteCommand, getAllCommands, updateCommand } from '@/lib/commands-store';
import { generateFlowNode } from '@/ai/flows/generate-flow-node';
import { generateAIResponse, getAIConfig } from '@/services/ai-provider';
import { SubActionType, TriggerType } from '@/services/automation/types';

export type AssistantAutomationResponse = {
  assistantMessage: string;
  automation?: {
    name: string;
    triggers: any[];
    subActions: any[];
    command?: {
      name?: string;
      command: string;
    };
    metadata?: Record<string, any>;
  };
  codeSnippets?: Array<{ language: string; code: string; description: string }>;
  suggestedChanges?: string[];
};

export interface AssistantAutomationInput {
  message: string;
  selectedCommandId?: string | null;
  currentWorkflow?: {
    name?: string;
    triggers?: any[];
    subActions?: any[];
  };
  tenantId?: string;
  userName?: string;
  editCurrentWorkflow?: boolean;
}

export interface CreatedWorkflowResult {
  assistantMessage: string;
  action: any;
  command: any | null;
  commandText: string | null;
  requiresReview: boolean;
}

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
  if (text === 'chat' || text === 'chat-message' || text === 'chat_message' || text === 'message') return TriggerType.CHAT_MESSAGE;
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
  if (text === 'send-chat' || text === 'send_message' || text === 'chat-message') return SubActionType.SEND_MESSAGE;
  if (text === 'send-discord') return SubActionType.DISCORD_SEND_MESSAGE;
  if (text === 'wait' || text === 'delay' || text === 'countdown-wait') return SubActionType.WAIT;
  if (text === 'if-else' || text === 'condition') return SubActionType.IF_ELSE;
  if (text === 'run-action') return SubActionType.RUN_ACTION;
  if (text === 'action-state') return SubActionType.ACTION_STATE;
  if (text === 'set-global-var') return SubActionType.SET_GLOBAL_VAR;
  if (text === 'get-global-var') return SubActionType.GET_GLOBAL_VAR;
  if (text === 'set-argument') return SubActionType.SET_ARGUMENT;
  if (text === 'set-user-var') return SubActionType.SET_USER_VAR;
  if (text === 'get-user-var') return SubActionType.GET_USER_VAR;
  if (text === 'math-operation' || text === 'math') return SubActionType.MATH_OPERATION;
  if (text === 'string-operation' || text === 'string') return SubActionType.STRING_OPERATION;
  if (text === 'http-request' || text === 'http_request' || text === 'fetch-url') return SubActionType.HTTP_REQUEST;
  if (text === 'twitch-timeout-user' || text === 'timeout-user' || text === 'timeout') return SubActionType.TWITCH_TIMEOUT_USER;
  if (text === 'comment' || text === 'log') return SubActionType.COMMENT;
  if (
    text === 'voice-reply' ||
    text === 'voice_reply' ||
    text === 'voice-reply-prompt' ||
    text === 'voice_reply_prompt' ||
    text === 'private-voice-reply'
  ) return SubActionType.VOICE_REPLY_PROMPT;
  if (
    text === 'execute-code' ||
    text === 'execute_code' ||
    text === 'code' ||
    text === 'code-block' ||
    text === 'program' ||
    text === 'programmable'
  ) return SubActionType.EXECUTE_CODE;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : SubActionType.SEND_MESSAGE;
}

function inferCommandLabel(message: string): string | null {
  const match = message.match(/!\w[\w-]*/);
  return match ? match[0] : null;
}

function normalizeCommandText(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.startsWith('!') ? text : `!${text.replace(/^!+/, '')}`;
}

function inferCommandFromIdea(message: string): string {
  const ignored = new Set([
    'a', 'an', 'and', 'automation', 'build', 'command', 'create', 'do', 'for', 'from',
    'make', 'me', 'of', 'please', 'that', 'the', 'then', 'to', 'viewer', 'viewers',
    'when', 'workflow', 'you',
  ]);
  const tokens = String(message || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token && !ignored.has(token));
  const candidate = tokens[tokens.length - 1] || 'custom';
  return `!${candidate.slice(0, 32)}`;
}

function workflowNameForCommand(commandLabel: string | null, fallback = 'AI Drafted Workflow'): string {
  if (!commandLabel) return fallback;
  const base = commandLabel.replace(/^!+/, '').replace(/[-_]/g, ' ').trim();
  if (!base) return fallback;
  return `${base.charAt(0).toUpperCase()}${base.slice(1)} Workflow`;
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

function containsCodeSubAction(subActions: any[]): boolean {
  return subActions.some((subAction) => Number(subAction?.type) === SubActionType.EXECUTE_CODE);
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

function isTimerPrompt(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('timer') ||
    lower.includes('countdown') ||
    lower.includes('settimer') ||
    lower.includes('set timer')
  );
}

function isTimeoutPrompt(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('!timeout') || (lower.includes('timeout') && lower.includes('5 min'));
}

function buildTimeoutAutomationDraft(message: string, selectedCommandId?: string | null, currentWorkflow?: any): AssistantAutomationResponse {
  const commandLabel = inferCommandLabel(message) || '!timeout';
  const triggers = [...asWorkflowArray(currentWorkflow?.triggers)];
  const hasCommandTrigger = triggers.some((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND);
  if (!hasCommandTrigger && selectedCommandId) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      commandId: selectedCommandId,
    });
  } else if (!hasCommandTrigger) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      command: commandLabel,
    });
  }

  return {
    assistantMessage: `I drafted a ${commandLabel} moderation workflow that parses the first argument as the target user, times them out for 5 minutes, and then announces it in chat.`,
    automation: {
      name: currentWorkflow?.name?.trim() || workflowNameForCommand(commandLabel, 'Timeout Workflow'),
      triggers,
      subActions: [
        {
          id: newId(),
          type: SubActionType.TWITCH_TIMEOUT_USER,
          enabled: true,
          weight: 0,
          index: 0,
          userName: '%targetUser%',
          duration: 300,
          reason: 'Timed out by chat command',
        },
        {
          id: newId(),
          type: SubActionType.SEND_MESSAGE,
          enabled: true,
          weight: 0,
          index: 1,
          text: '%targetUser% is in timeout for 5 minutes.',
          useBot: true,
        },
      ],
      ...(!selectedCommandId ? { command: { name: commandLabel.replace(/^!/, ''), command: commandLabel } } : {}),
      metadata: {
        generatedFallback: 'timeout',
      },
    },
    suggestedChanges: [
      'The first command argument becomes %targetUser%, so moderators can use !timeout @user.',
      'Change the duration or message text if you want a different moderation policy.',
    ],
  };
}

function buildTimerAutomationDraft(message: string, selectedCommandId?: string | null, currentWorkflow?: any): AssistantAutomationResponse {
  const commandLabel = inferCommandLabel(message) || '!settimer';
  const triggers = [...asWorkflowArray(currentWorkflow?.triggers)];
  const hasCommandTrigger = triggers.some((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND);
  if (!hasCommandTrigger && selectedCommandId) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      commandId: selectedCommandId,
    });
  } else if (!hasCommandTrigger) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      command: commandLabel,
    });
  }

  return {
    assistantMessage: `I drafted a real timer workflow for ${commandLabel}. It parses the command text, defaults to 5 minutes when no time is provided, announces the start, waits for the computed duration, then announces that the timer finished.`,
    automation: {
      name: currentWorkflow?.name?.trim() || workflowNameForCommand(commandLabel, 'Timer Workflow'),
      triggers,
      subActions: [
        {
          id: newId(),
          type: SubActionType.EXECUTE_CODE,
          enabled: true,
          weight: 0,
          index: 0,
          language: 'javascript',
          description: 'Parse timer duration from the command input and fall back to 5 minutes.',
          timeoutMs: 3000,
          code: [
            'const raw = String(variables.rawInput || variables.message || "").trim();',
            'const input = raw.replace(/^!\\w+\\s*/i, "").trim();',
            'const token = input.split(/\\s+/).filter(Boolean)[0] || "";',
            'const match = token.match(/^(\\d+)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/i);',
            'let durationMs = 5 * 60 * 1000;',
            'let durationLabel = "5 minutes";',
            'if (match) {',
            '  const amount = Math.max(1, Number(match[1] || 5));',
            '  const unit = String(match[2] || "m").toLowerCase();',
            '  if (["s", "sec", "secs", "second", "seconds"].includes(unit)) {',
            '    durationMs = amount * 1000;',
            '    durationLabel = `${amount} second${amount === 1 ? "" : "s"}`;',
            '  } else if (["h", "hr", "hrs", "hour", "hours"].includes(unit)) {',
            '    durationMs = amount * 60 * 60 * 1000;',
            '    durationLabel = `${amount} hour${amount === 1 ? "" : "s"}`;',
            '  } else {',
            '    durationMs = amount * 60 * 1000;',
            '    durationLabel = `${amount} minute${amount === 1 ? "" : "s"}`;',
            '  }',
            '}',
            'return { timerDurationMs: durationMs, timerDurationLabel: durationLabel };',
          ].join('\n'),
        },
        {
          id: newId(),
          type: SubActionType.SEND_MESSAGE,
          enabled: true,
          weight: 0,
          index: 1,
          text: 'Timer started for %timerDurationLabel%.',
          useBot: false,
        },
        {
          id: newId(),
          type: SubActionType.WAIT,
          enabled: true,
          weight: 0,
          index: 2,
          value: '%timerDurationMs%',
          minValue: '%timerDurationMs%',
          maxValue: '%timerDurationMs%',
        },
        {
          id: newId(),
          type: SubActionType.SEND_MESSAGE,
          enabled: true,
          weight: 0,
          index: 3,
          text: 'Timer finished after %timerDurationLabel%.',
          useBot: false,
        },
      ],
      ...(!selectedCommandId ? { command: { name: commandLabel.replace(/^!/, ''), command: commandLabel } } : {}),
      metadata: {
        generatedFallback: 'timer',
      },
    },
    suggestedChanges: [
      'Swap the broadcaster chat replies to bot replies if you want the bot account to announce the timer.',
      'Add an OBS/browser-source step afterward if you want a visible countdown overlay instead of chat-only feedback.',
    ],
  };
}

function isLurkPrompt(message: string): boolean {
  const lower = message.toLowerCase();
  return /\blurk\b/.test(lower) && !/\bunlurk\b/.test(lower);
}

function buildLurkAutomationDraft(selectedCommandId?: string | null, currentWorkflow?: any): AssistantAutomationResponse {
  const commandLabel = '!lurk';
  const triggers = [...asWorkflowArray(currentWorkflow?.triggers)];
  const hasCommandTrigger = triggers.some((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND);

  if (!hasCommandTrigger && selectedCommandId) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      commandId: selectedCommandId,
    });
  } else if (!hasCommandTrigger) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      command: commandLabel,
    });
  }

  return {
    assistantMessage: selectedCommandId
      ? 'I drafted a reusable !lurk workflow using the app command/action flow, not a hardcoded dispatcher reply.'
      : 'I drafted a reusable !lurk workflow using the app command/action flow. Save it, then publish the resulting flow package if you want it in the community library.',
    automation: {
      name: currentWorkflow?.name?.trim() || 'Lurk Workflow',
      triggers,
      subActions: [
        {
          id: newId(),
          type: SubActionType.SEND_MESSAGE,
          enabled: true,
          weight: 0,
          index: 0,
          text: '%userName% is lurking in the shadows 👀',
          useBot: true,
        },
      ],
      ...(!selectedCommandId ? { command: { name: 'lurk', command: commandLabel } } : {}),
      metadata: {
        generatedFallback: 'lurk',
        communityPackageId: 'flow.utility.lurk',
      },
    },
    suggestedChanges: [
      'Adjust the reply text if you want a custom lurk voice.',
      'Publish the flow package after saving if you want other streamers to import it from Community.',
    ],
  };
}

function buildProgrammableFallback(message: string, commandLabel?: string | null, currentWorkflow?: any): AssistantAutomationResponse {
  const normalizedCommand = normalizeCommandText(commandLabel || '!newflow');
  return {
    assistantMessage: 'I drafted a programmable workflow block because the request is beyond the current built-in primitives. Review the generated code before enabling it live.',
    automation: {
      name: currentWorkflow?.name?.trim() || 'Programmable AI Workflow',
      triggers: [
        {
          id: newId(),
          type: TriggerType.COMMAND,
          enabled: true,
          exclusions: [],
          command: normalizedCommand,
        },
      ],
      subActions: [
        {
          id: newId(),
          type: SubActionType.EXECUTE_CODE,
          enabled: true,
          weight: 0,
          index: 0,
          language: 'javascript',
          description: 'AI programmable fallback block',
          timeoutMs: 10000,
          code: [
            `// Request: ${message}`,
            '// Helpers available: reply, runAction, sleep, http, vars.global, vars.user, points, fetch',
            `await reply("Programmable block created for ${normalizedCommand}. Fill in the custom logic before enabling it.", { as: "bot" });`,
            'return { ok: true };',
          ].join('\n'),
        },
      ],
      command: {
        name: normalizedCommand.replace(/^!/, ''),
        command: normalizedCommand,
      },
      metadata: {
        generatedFallback: 'programmable',
      },
    },
    suggestedChanges: [
      'Replace the placeholder code with the real logic you want.',
      'Keep draft review on for programmable flows.',
    ],
  };
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
    const waitMs = Number(node?.data?.seconds || 0) * 1000 || 1000;
    return {
      id: newId(),
      type: SubActionType.WAIT,
      enabled: true,
      weight: 0,
      index,
      value: waitMs,
      minValue: waitMs,
      maxValue: waitMs,
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

async function buildFallbackAutomation(message: string, selectedCommandId?: string | null, currentWorkflow?: any): Promise<AssistantAutomationResponse> {
  if (isVoiceReplyPrompt(message)) {
    return buildVoiceReplyAutomationDraft(message, currentWorkflow);
  }

  if (isTimerPrompt(message)) {
    return buildTimerAutomationDraft(message, selectedCommandId, currentWorkflow);
  }

  if (isTimeoutPrompt(message)) {
    return buildTimeoutAutomationDraft(message, selectedCommandId, currentWorkflow);
  }

  if (isRpsChallengePrompt(message)) {
    return buildRpsAutomationDraft(message, selectedCommandId, currentWorkflow);
  }

  if (isLurkPrompt(message)) {
    return buildLurkAutomationDraft(selectedCommandId, currentWorkflow);
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
      name: currentWorkflow?.name?.trim() || workflowNameForCommand(commandLabel),
      triggers,
      subActions: [subAction],
      metadata: {
        editCurrentWorkflow: Boolean(currentWorkflow),
      },
      ...(!selectedCommandId && commandLabel ? { command: { name: commandLabel.replace(/^!/, ''), command: commandLabel } } : {}),
    },
    suggestedChanges: ['Review the trigger and adjust the response text before saving.'],
  };
}

function buildCapabilityPrompt(input: AssistantAutomationInput): string {
  return [
    'You are StreamWeaver AI Automation Assistant.',
    'Return strict JSON only, no markdown fences.',
    'Primary goal: create valid, reusable StreamWeaver automation drafts similar to Streamer.bot actions + triggers.',
    'Schema:',
    '{',
    '  "assistantMessage": string,',
    '  "automation": {',
    '    "name": string,',
    '    "triggers": Array<object>,',
    '    "subActions": Array<object>,',
    '    "command"?: { "name"?: string, "command": string },',
    '    "metadata"?: object',
    '  },',
    '  "codeSnippets": Array<{ "language": string, "code": string, "description": string }>,',
    '  "suggestedChanges": string[]',
    '}',
    'Supported trigger types: command, chat-message, follow, cheer, subscribe, resub, gift-sub, gift-bomb, raid, channel-point-reward.',
    'Supported sub-action types: send-chat, send-discord, wait, if-else, run-action, action-state, set-global-var, get-global-var, set-argument, set-user-var, get-user-var, math-operation, string-operation, http-request, voice-reply-prompt, comment, execute-code.',
    'For execute-code, produce JavaScript only and include fields: type="execute-code", language="javascript", description, code, timeoutMs.',
    'The execute-code helper block can call: reply(text,{as}), runAction(actionId), sleep(ms), http({url,method,headers,body,json}), vars.global.get/set, vars.user.get/set, points.get/add/set, and fetch.',
    'Prefer built-in primitives first. Use execute-code only when required for missing integrations, unusual state machines, or programmable extensions.',
    'If the user asks for a timer or countdown, use send-chat + wait steps where possible.',
    'If the user asks for a command and does not specify one clearly, infer a reasonable !command and include it in automation.command.',
    `User: ${input.userName || 'User'}`,
    `Selected command id: ${input.selectedCommandId || 'none'}`,
    `Current workflow: ${JSON.stringify({
      name: input.currentWorkflow?.name || '',
      triggers: input.currentWorkflow?.triggers || [],
      subActions: input.currentWorkflow?.subActions || [],
    })}`,
    `Request: ${input.message}`,
    'Keep workflows user-friendly, modular, and editable.',
  ].join('\n');
}

export async function generateAutomationAssistantResponse(input: AssistantAutomationInput): Promise<AssistantAutomationResponse> {
  const { message, selectedCommandId, currentWorkflow, tenantId } = input;
  const aiConfig = getAIConfig(tenantId);
  const commandLabel = inferCommandLabel(message);

  const fallback = isCodePrompt(message)
    ? buildCodeFallback(message)
    : await buildFallbackAutomation(message, selectedCommandId, currentWorkflow);
  if (isVoiceReplyPrompt(message) || isTimeoutPrompt(message) || isLurkPrompt(message)) {
    return fallback;
  }

  if (!aiConfig.apiKey) {
    return fallback;
  }

  let responseText = '';
  try {
    responseText = await generateAIResponse(
      buildCapabilityPrompt(input),
      'You are a concise automation planner.',
      tenantId,
      { maxTokens: 1200, temperature: 0.5 }
    );
  } catch (error) {
    console.warn('[Automation Assistant] AI generation failed, using fallback:', error);
    return fallback;
  }

  if (!responseText.trim() || responseText.trim() === 'AI response failed') {
    return fallback;
  }

  const parsedResponse = extractJsonObject(responseText);
  if (!parsedResponse || typeof parsedResponse !== 'object') {
    return {
      ...fallback,
      assistantMessage: responseText.trim() || fallback.assistantMessage,
    };
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

  const normalized: AssistantAutomationResponse = {
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
      metadata: {
        ...(automation?.metadata && typeof automation.metadata === 'object' ? automation.metadata : {}),
        editCurrentWorkflow: Boolean(input.editCurrentWorkflow && input.currentWorkflow),
      },
    },
    codeSnippets: Array.isArray(parsedResponse.codeSnippets) ? parsedResponse.codeSnippets : fallback.codeSnippets || [],
    suggestedChanges: Array.isArray(parsedResponse.suggestedChanges)
      ? parsedResponse.suggestedChanges
      : fallback.suggestedChanges || [],
  };

  if (!normalized.automation?.subActions?.length) {
    return buildProgrammableFallback(message, commandLabel, currentWorkflow);
  }

  return normalized;
}

function ensureCommandLabel(automation: any, sourceMessage: string): string {
  const fromTrigger = asWorkflowArray(automation?.triggers).find((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND);
  const commandText = normalizeCommandText(
    fromTrigger?.command ||
      fromTrigger?.commandName ||
      automation?.command?.command ||
      automation?.command ||
      inferCommandLabel(sourceMessage) || inferCommandFromIdea(sourceMessage)
  );

  return commandText;
}

export async function createWorkflowFromPrompt(input: AssistantAutomationInput): Promise<CreatedWorkflowResult> {
  const draft = await generateAutomationAssistantResponse(input);
  const automation = draft.automation;
  if (!automation) {
    throw new Error('AI did not return an automation draft.');
  }

  const commandText = ensureCommandLabel(automation, input.message);
  const commandName = String(automation?.command?.name || commandText.replace(/^!/, '') || automation.name || 'AI Workflow').trim();

  const existingCommands = await getAllCommands(input.tenantId);
  const existingCommand = commandText
    ? existingCommands.find((command: any) => String(command.command || '').trim().toLowerCase() === commandText.toLowerCase())
    : null;
  if (existingCommand) {
    throw new Error(`Command ${commandText} already exists.`);
  }

  const requiresReview = containsCodeSubAction(automation.subActions || []);
  const command = commandText
    ? await createCommand({
        name: commandName,
        command: commandText,
        group: 'AI Automations',
        enabled: false,
        description: `AI-generated from: ${input.message}`,
        aiGenerated: true,
        draftStatus: 'draft',
      } as any, input.tenantId)
    : null;

  const triggers = asWorkflowArray(automation.triggers).map((trigger: any) => {
    const normalized = {
      ...trigger,
      id: String(trigger?.id || newId()),
      type: normalizeTriggerType(trigger?.type),
      enabled: trigger?.enabled ?? true,
      exclusions: Array.isArray(trigger?.exclusions) ? trigger.exclusions : [],
    } as any;

    if (Number(normalized.type) === TriggerType.COMMAND && command?.id) {
      delete normalized.command;
      delete normalized.commandName;
      normalized.commandId = command.id;
    }

    return normalized;
  });

  if (command?.id && !triggers.some((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND)) {
    triggers.unshift({
      id: newId(),
      type: TriggerType.COMMAND,
      enabled: true,
      exclusions: [],
      commandId: command.id,
    });
  }

  const subActions = asWorkflowArray(automation.subActions).map((subAction: any, index: number) => ({
    ...subAction,
    id: String(subAction?.id || newId()),
    type: normalizeSubActionType(subAction?.type),
    enabled: subAction?.enabled ?? true,
    weight: Number(subAction?.weight ?? 0),
    index: Number(subAction?.index ?? index),
  }));

  let action: any;
  try {
    action = await createAction({
      name: String(automation.name || commandName || 'AI Workflow').trim() || 'AI Workflow',
      group: 'AI Automations',
      enabled: false,
      triggers,
      subActions,
      aiGenerated: true,
      aiPrompt: input.message,
      draftStatus: requiresReview ? 'review-required' : 'draft',
      requiresReview,
      metadata: {
        createdBy: input.userName || 'unknown',
        createdFrom: 'chat-ai',
        ...(automation.metadata || {}),
      },
    } as any, input.tenantId);
  } catch (error) {
    // Do not leave an orphan command behind when action persistence fails.
    if (command?.id) await deleteCommand(String(command.id), input.tenantId).catch(() => {});
    throw error;
  }

  return {
    assistantMessage: draft.assistantMessage,
    action,
    command,
    commandText: commandText || null,
    requiresReview,
  };
}

export async function setWorkflowEnabledByCommand(commandText: string, enabled: boolean, tenantId?: string) {
  const normalizedCommand = normalizeCommandText(commandText);
  const commands = await getAllCommands(tenantId);
  const command = commands.find((entry: any) => String(entry.command || '').trim().toLowerCase() === normalizedCommand.toLowerCase());
  if (!command) {
    throw new Error(`Command ${normalizedCommand} was not found.`);
  }

  await updateCommand(String(command.id), {
    enabled,
    draftStatus: enabled ? 'live' : 'draft',
  } as any, tenantId);

  const actions = await getAllActions(tenantId);
  const linkedActions = actions.filter((action: any) =>
    Array.isArray(action.triggers) &&
    action.triggers.some((trigger: any) =>
      Number(trigger?.type) === TriggerType.COMMAND &&
      String(trigger?.commandId || '') === String(command.id)
    )
  );

  for (const action of linkedActions) {
    await updateAction(String(action.id), {
      enabled,
      draftStatus: enabled ? 'live' : 'draft',
      requiresReview: false,
    } as any, tenantId);
  }

  return { command, linkedActions };
}

export async function deleteWorkflowByCommand(commandText: string, tenantId?: string) {
  const normalizedCommand = normalizeCommandText(commandText);
  const commands = await getAllCommands(tenantId);
  const command = commands.find((entry: any) => String(entry.command || '').trim().toLowerCase() === normalizedCommand.toLowerCase());
  if (!command) {
    throw new Error(`Command ${normalizedCommand} was not found.`);
  }

  const actions = await getAllActions(tenantId);
  const linkedActions = actions.filter((action: any) =>
    Array.isArray(action.triggers) &&
    action.triggers.some((trigger: any) =>
      Number(trigger?.type) === TriggerType.COMMAND &&
      String(trigger?.commandId || '') === String(command.id)
    )
  );

  for (const action of linkedActions) {
    await deleteAction(String(action.id), tenantId);
  }
  await deleteCommand(String(command.id), tenantId);

  return { command, linkedActions };
}
