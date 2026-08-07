import { createHash } from 'crypto';
import { getAllCommands } from '@/lib/commands-store';
import type {
  AthenaDecision,
  AthenaRequest,
  AthenaSurface,
} from '@/services/athena-contract';
import {
  isLiveAthenaSurface,
  surfaceAllowsTransportCommands,
} from '@/services/athena-contract';
import { requestAthenaJson } from '@/services/athena-model';
import {
  detectOpenBotCommand,
  runOpenBotCommand,
  type OpenBotCommand,
} from '@/services/open-bot-commands';
import { runImageCommand } from '@/services/image-command';

export type AthenaActionOutcome = {
  decision: AthenaDecision;
  response?: string;
  images?: string[];
  toolResult?: string;
  provider?: string;
  model?: string;
};

type ToolRisk = 'read' | 'reversible' | 'destructive';

type ToolSpec = {
  id: string;
  description: string;
  risk: ToolRisk;
  surfaces: AthenaSurface[] | 'all';
  visibility: 'public' | 'private' | 'both';
};

const OPEN_TOOL_IDS: Record<OpenBotCommand, string> = {
  'live-members': 'community.live-members',
  'chat-tag-current': 'chattag.current',
  'chat-tag-status': 'chattag.status',
  'chat-tag-leaderboard': 'chattag.leaderboard',
  apps: 'spmt.apps',
  hearmeout: 'hearmeout.status',
  help: 'athena.help',
};

const OPEN_COMMAND_BY_TOOL = Object.fromEntries(
  Object.entries(OPEN_TOOL_IDS).map(([command, toolId]) => [toolId, command]),
) as Record<string, OpenBotCommand>;

const TOOL_CATALOG: ToolSpec[] = [
  { id: 'community.live-members', description: 'Read which SpaceMountain community members are live now.', risk: 'read', surfaces: 'all', visibility: 'both' },
  { id: 'chattag.current', description: 'Read who is currently IT in ChatTag.', risk: 'read', surfaces: 'all', visibility: 'both' },
  { id: 'chattag.status', description: 'Read ChatTag player and activity counts.', risk: 'read', surfaces: 'all', visibility: 'both' },
  { id: 'chattag.leaderboard', description: 'Read the ChatTag top-three leaderboard.', risk: 'read', surfaces: 'all', visibility: 'both' },
  { id: 'spmt.apps', description: 'Read the current SPMT app catalog.', risk: 'read', surfaces: 'all', visibility: 'both' },
  { id: 'hearmeout.status', description: 'Read HearMeOut now-playing and queue status.', risk: 'read', surfaces: 'all', visibility: 'both' },
  { id: 'athena.help', description: 'Explain Athena safe public capabilities.', risk: 'read', surfaces: 'all', visibility: 'both' },
  { id: 'image.generate', description: 'Generate one or more images using the image router for the current public/private scope.', risk: 'reversible', surfaces: 'all', visibility: 'both' },
  { id: 'transport.command', description: 'Hand an explicit chat command to the current Twitch, Kick, or Discord dispatcher.', risk: 'reversible', surfaces: ['twitch-chat', 'kick-chat', 'discord-channel', 'discord-dm'], visibility: 'both' },
];

const IMAGE_REQUEST_RE = /^(?:please\s+)?(?:generate|create|draw|make|render)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|art|illustration)\b|\b(?:image|picture)\s+of\b/i;
const COMMAND_WORD_RE = /^!?([a-z][a-z0-9_-]{1,40})(?:\s+([\s\S]*))?$/i;

function toolAllowed(tool: ToolSpec, request: AthenaRequest): boolean {
  if (tool.visibility !== 'both' && tool.visibility !== request.visibility) return false;
  return tool.surfaces === 'all' || tool.surfaces.includes(request.location.surface);
}

function commandRisk(command: string): ToolRisk {
  const name = command.replace(/^!/, '').split(/\s+/)[0].toLowerCase();
  if (/^(?:delete|remove|reset|clear|ban|unban|timeout|purge|deploy|restart|stop|shutdown|settoall|resetallpoints)$/.test(name)) {
    return 'destructive';
  }
  if (/^(?:add|set|enable|disable|toggle|start|approve|publish|send|say|so|img|genmode)$/.test(name)) {
    return 'reversible';
  }
  return 'read';
}

function actionId(input: string): string {
  return `act_${createHash('sha256').update(input).digest('hex').slice(0, 18)}`;
}

function imagePromptFromMessage(message: string): string {
  return message
    .replace(/^!img\s*/i, '')
    .replace(/^(?:please\s+)?(?:generate|create|draw|make|render)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|art|illustration)\s*(?:of\s+)?/i, '')
    .trim();
}

async function configuredTransportCommands(tenantId: string): Promise<Array<{ name: string; description: string; enabled: boolean }>> {
  const commands = await getAllCommands(tenantId).catch(() => []);
  return commands
    .map((command: any) => ({
      name: String(command?.command || command?.name || '').replace(/^!/, '').trim().toLowerCase(),
      description: String(command?.description || command?.name || '').trim().slice(0, 240),
      enabled: command?.enabled !== false,
    }))
    .filter((command) => command.name && command.enabled)
    .filter((command, index, all) => all.findIndex((candidate) => candidate.name === command.name) === index)
    .slice(0, 160);
}

function deterministicDecision(request: AthenaRequest): AthenaDecision | null {
  const text = request.message.trim();
  if (!text) return null;

  const openCommand = detectOpenBotCommand(text);
  if (openCommand) {
    return {
      mode: 'tool',
      reason: 'Matched a safe read tool deterministically.',
      confidence: 1,
      toolId: OPEN_TOOL_IDS[openCommand],
      risk: 'read',
    };
  }

  if (/^!img(?:\s|$)/i.test(text) || IMAGE_REQUEST_RE.test(text)) {
    const prompt = imagePromptFromMessage(text);
    if (!prompt) return null;
    return {
      mode: 'tool',
      reason: 'The user explicitly requested image generation.',
      confidence: 1,
      toolId: 'image.generate',
      arguments: { prompt },
      risk: 'reversible',
    };
  }

  if (text.startsWith('!') && surfaceAllowsTransportCommands(request.location.surface)) {
    return {
      mode: 'command',
      reason: 'An explicit platform command should use the current transport dispatcher.',
      confidence: 1,
      toolId: 'transport.command',
      command: text,
      risk: commandRisk(text),
    };
  }

  return null;
}

function validToolId(value: unknown, request: AthenaRequest): string | undefined {
  const id = String(value || '').trim();
  const tool = TOOL_CATALOG.find((candidate) => candidate.id === id && toolAllowed(candidate, request));
  return tool?.id;
}

function normalizeCommand(value: unknown, available: Set<string>): string | undefined {
  const raw = String(value || '').trim();
  const match = raw.match(COMMAND_WORD_RE);
  if (!match) return undefined;
  const name = match[1].toLowerCase();
  if (!available.has(name)) return undefined;
  const args = String(match[2] || '').trim();
  return `!${name}${args ? ` ${args}` : ''}`;
}

export async function decideAthenaAction(request: AthenaRequest): Promise<AthenaDecision> {
  const deterministic = deterministicDecision(request);
  if (deterministic) return deterministic;

  const commands = surfaceAllowsTransportCommands(request.location.surface)
    ? await configuredTransportCommands(request.tenantId)
    : [];
  const toolLines = TOOL_CATALOG
    .filter((tool) => toolAllowed(tool, request))
    .map((tool) => `${tool.id} | risk=${tool.risk} | ${tool.description}`);
  const commandLines = commands.map((command) => `!${command.name} | ${command.description || 'configured platform command'}`);

  try {
    const result = await requestAthenaJson({
      system: [
        'You are Athena\'s action router.',
        'Decide whether the latest message is ordinary conversation, a safe tool request, or a configured transport command.',
        'Location and capability boundaries are mandatory. Never invent a tool or command.',
        'Use a tool when the human asks for live/current app state that a listed tool can retrieve.',
        'Use a command only when the user clearly wants the action performed, not when discussing the action hypothetically.',
        'For ambiguous requests choose chat.',
        'Return one JSON object only with keys: mode, reason, confidence, toolId, command, arguments.',
        'mode must be chat, tool, or command.',
      ].join(' '),
      prompt: [
        `Visibility: ${request.visibility}`,
        `Surface: ${request.location.surface}`,
        `App: ${request.location.app || 'streamweaver'}`,
        `Live: ${request.location.live ?? isLiveAthenaSurface(request.location.surface)}`,
        `Capabilities: ${(request.location.capabilities || []).join(', ') || 'none declared'}`,
        '',
        'Allowed tools:',
        ...toolLines,
        '',
        'Configured commands on this surface:',
        ...(commandLines.length ? commandLines : ['none']),
        '',
        `Human message: ${request.message}`,
      ].join('\n'),
      maxTokens: 450,
    });

    const mode = String(result.data.mode || '').toLowerCase();
    const confidence = Math.max(0, Math.min(1, Number(result.data.confidence) || 0));
    const reason = String(result.data.reason || 'Local action router decision.').trim().slice(0, 500);
    if (mode === 'tool') {
      const toolId = validToolId(result.data.toolId, request);
      if (toolId) {
        const risk = TOOL_CATALOG.find((tool) => tool.id === toolId)?.risk || 'read';
        return {
          mode: 'tool',
          reason,
          confidence,
          toolId,
          risk,
          arguments: result.data.arguments && typeof result.data.arguments === 'object'
            ? result.data.arguments as Record<string, unknown>
            : undefined,
        };
      }
    }
    if (mode === 'command' && surfaceAllowsTransportCommands(request.location.surface)) {
      const available = new Set(commands.map((command) => command.name));
      const command = normalizeCommand(result.data.command, available);
      if (command) {
        return {
          mode: 'command',
          reason,
          confidence,
          toolId: 'transport.command',
          command,
          risk: commandRisk(command),
        };
      }
    }
  } catch (error) {
    console.warn('[Athena Tools] Local decision routing failed; continuing as chat', error);
  }

  return {
    mode: 'chat',
    reason: 'No valid tool or command intent was established.',
    confidence: 0.75,
  };
}

function confirmationRequired(decision: AthenaDecision, request: AthenaRequest): boolean {
  if (decision.mode !== 'command') return false;
  if (decision.risk === 'read') return false;
  if (request.message.trim().startsWith('!')) return false;
  return true;
}

export async function executeAthenaDecision(request: AthenaRequest, decision: AthenaDecision): Promise<AthenaActionOutcome> {
  if (decision.mode === 'chat') return { decision };

  if (confirmationRequired(decision, request)) {
    const id = actionId([
      request.tenantId,
      request.actor.userId || request.actor.username,
      request.location.surface,
      decision.command,
    ].join('|'));
    if (request.confirmedActionId !== id) {
      return {
        decision: {
          ...decision,
          mode: 'confirm',
          actionId: id,
          executed: false,
        },
        response: `I can run ${decision.command}, but it changes state. Confirm action ${id} to continue.`,
      };
    }
  }

  if (decision.toolId && OPEN_COMMAND_BY_TOOL[decision.toolId]) {
    const response = await runOpenBotCommand(OPEN_COMMAND_BY_TOOL[decision.toolId]);
    return {
      decision: { ...decision, executed: true, delivered: false },
      response,
      toolResult: response,
    };
  }

  if (decision.toolId === 'image.generate') {
    const prompt = String(decision.arguments?.prompt || imagePromptFromMessage(request.message)).trim();
    if (!prompt) {
      return {
        decision: { ...decision, executed: false },
        response: 'Tell me what image you want generated.',
      };
    }
    const command = `!img ${prompt}`;
    const result = await runImageCommand(command, request.tenantId, { scope: request.visibility });
    const response = result.images.length
      ? `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} with ${result.provider || 'the configured image provider'}.`
      : 'The image provider returned no image.';
    return {
      decision: { ...decision, executed: true, delivered: false },
      response,
      images: result.images,
      toolResult: `${response}\nPrompt: ${result.originalPrompt}`,
      provider: result.provider,
    };
  }

  if (decision.mode === 'command' && decision.command) {
    return {
      decision: {
        ...decision,
        executed: false,
        delivered: false,
      },
      response: `Command handoff ready for ${request.location.surface}: ${decision.command}`,
      toolResult: `Transport command handoff: ${decision.command}`,
    };
  }

  return {
    decision: { ...decision, mode: 'chat', executed: false },
  };
}

export function getAthenaToolCatalog(request: AthenaRequest): ToolSpec[] {
  return TOOL_CATALOG.filter((tool) => toolAllowed(tool, request));
}
