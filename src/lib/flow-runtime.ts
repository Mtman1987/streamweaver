import type { FlowGraph, FlowNode, FlowEdge } from '@/types/flows';
import type { FlowExecutionContext, FlowNodeOutcome, FlowLogEvent } from '@/types/flows-runtime';
import { conversationalResponse } from '@/ai/flows/conversational-response';
import { textToSpeech } from '@/ai/flows/text-to-speech';
import { sendDiscordMessage } from '@/services/discord';
import { sendChatMessage } from '@/services/twitch';
import { addPoints, setPoints, getPoints as fetchPoints, getLeaderboard as fetchLeaderboard } from '@/services/points';

type Services = FlowExecutionContext['services'];

type NodeExecutor = (
  node: FlowNode,
  context: FlowExecutionContext
) => Promise<FlowNodeOutcome>;

const DEFAULT_OUTCOME: FlowNodeOutcome = 'success';

function toNumber(value: string): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function parseJsonTemplate(template: any, context: FlowExecutionContext) {
  if (template === undefined || template === null) return undefined;
  const rendered = renderTemplate(JSON.stringify(template), context);
  return JSON.parse(rendered);
}

const nodeExecutors: Record<string, NodeExecutor> = {
  'trigger:start': async () => DEFAULT_OUTCOME,
  'action:send-chat': async (node, context) => {
    const message = renderTemplate(node.data?.message ?? '', context);
    const as = node.data?.as === 'bot' ? 'bot' : 'broadcaster';
    if (!message) {
      throw new Error('Send Chat node requires a message.');
    }
    await context.services.sendChatMessage(message, as);
    context.lastOutput = message;
    return DEFAULT_OUTCOME;
  },
  'action:send-discord': async (node, context) => {
    const channelId =
      node.data?.channelId ?? process.env.NEXT_PUBLIC_DISCORD_LOG_CHANNEL_ID;
    if (!channelId) {
      throw new Error('Send Discord node requires a channel ID.');
    }
    const message = renderTemplate(node.data?.message ?? '', context);
    await context.services.sendDiscordMessage(channelId, message);
    context.lastOutput = message;
    return DEFAULT_OUTCOME;
  },
  'action:ai-response': async (node, context) => {
    const input = renderTemplate(node.data?.input ?? '', context);
    if (!input) {
      throw new Error('AI Response node requires input text.');
    }
    const personality =
      node.data?.personality ??
      context.vars[node.data?.personalityVar] ??
      context.personality;
    const response = await context.services.conversationalResponse({
      message: input,
      personality,
    });
    const saveKey = node.data?.saveAs || 'aiResponse';
    context.vars[saveKey] = response.response;
    context.lastOutput = response.response;
    return DEFAULT_OUTCOME;
  },
  'action:tts-broadcast': async (node, context) => {
    const text = renderTemplate(node.data?.text ?? '', context);
    if (!text) {
      throw new Error('TTS node requires text to speak.');
    }
    const voice =
      node.data?.voice || context.voice || process.env.NEXT_DEFAULT_TTS_VOICE || 'Algieba';
    const audio = await context.services.textToSpeech({ text, voice });
    context.services.broadcast({
      type: 'play-tts',
      payload: { audioDataUri: audio.audioDataUri },
    });
    context.lastOutput = text;
    return DEFAULT_OUTCOME;
  },
  'logic:set-variable': async (node, context) => {
    const key = node.data?.key;
    if (!key) {
      throw new Error('Set Variable node requires a key.');
    }
    const value = renderTemplate(
      node.data?.value ?? node.data?.default ?? '',
      context
    );
    context.vars[key] = value;
    context.lastOutput = value;
    return DEFAULT_OUTCOME;
  },
  'logic:delay': async (node, context) => {
    const secondsValue = renderTemplate(node.data?.seconds ?? node.data?.duration ?? '0', context);
    const seconds = toNumber(secondsValue);
    if (seconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
    context.lastOutput = seconds.toString();
    return DEFAULT_OUTCOME;
  },
  'condition:text-includes': async (node, context) => {
    const haystack = renderTemplate(node.data?.source ?? '{{lastOutput}}', context);
    const needle = renderTemplate(node.data?.value ?? '', context);
    if (!needle) {
      throw new Error('Text condition requires a value.');
    }
    const outcome: FlowNodeOutcome = haystack.includes(needle) ? 'true' : 'false';
    return outcome;
  },
  'condition:compare': async (node, context) => {
    const left = renderTemplate(node.data?.left ?? '', context);
    const right = renderTemplate(node.data?.right ?? '', context);
    const operator = (node.data?.operator || '==').toString();
    let result = false;
    switch (operator) {
      case '===':
      case '==':
        result = left == right;
        break;
      case '!==':
      case '!=':
        result = left != right;
        break;
      case '>':
        result = toNumber(left) > toNumber(right);
        break;
      case '>=':
        result = toNumber(left) >= toNumber(right);
        break;
      case '<':
        result = toNumber(left) < toNumber(right);
        break;
      case '<=':
        result = toNumber(left) <= toNumber(right);
        break;
      default:
        throw new Error(`Unsupported operator "${operator}" in compare condition.`);
    }
    return result ? 'true' : 'false';
  },
  'action:plugin-command': async (node, context) => {
    const pluginId = node.data?.pluginId;
    const command = node.data?.command;
    if (!pluginId || !command) {
      throw new Error('Plugin command node requires pluginId and command.');
    }
    const payload = parseJsonTemplate(node.data?.payload, context);
    await context.services.sendPluginCommand(pluginId, { command, payload });
    context.lastOutput = `${pluginId}:${command}`;
    return DEFAULT_OUTCOME;
  },
  'action:play-sound': async (node, context) => {
    const pluginId = node.data?.pluginId || 'apollo-station';
    const command = node.data?.command || 'playSound';
    const soundId = renderTemplate(node.data?.soundId ?? 'airhorn', context);
    const payload =
      parseJsonTemplate(node.data?.payload, context) ?? { soundId };
    await context.services.sendPluginCommand(pluginId, { command, payload });
    context.lastOutput = `${pluginId}:${soundId}`;
    return DEFAULT_OUTCOME;
  },
  'action:update-points': async (node, context) => {
    const userTemplate = node.data?.user ?? "{{tags['display-name'] || 'Commander'}}";
    const user = renderTemplate(userTemplate, context).trim();
    if (!user) {
      throw new Error('Update Points node requires a user.');
    }
    const operation = (node.data?.operation || 'add') as 'add' | 'set' | 'get';
    const amountValue = renderTemplate(String(node.data?.amount ?? '0'), context);
    const amount = toNumber(amountValue);
    const reason = node.data?.reason ? renderTemplate(node.data.reason, context) : undefined;
    let result: { points: number; level: number };
    if (operation === 'set') {
      result = await context.services.updatePoints({ user, amount, operation, reason });
    } else if (operation === 'get') {
      result = await context.services.getPoints(user);
    } else {
      result = await context.services.updatePoints({ user, amount, operation, reason });
    }
    if (node.data?.saveVar) {
      context.vars[node.data.saveVar] = result.points;
    }
    if (node.data?.saveLevelVar) {
      context.vars[node.data.saveLevelVar] = result.level;
    }
    context.lastOutput = `${user}:${result.points}`;
    return DEFAULT_OUTCOME;
  },
  'action:custom-script': async (node, context) => {
    const script = node.data?.code;
    if (!script) {
      throw new Error('Custom script node requires code.');
    }
    const fn = new Function(
      'context',
      'services',
      'vars',
      'args',
      'tags',
      `'use strict'; return (async () => { ${script}\n})();`
    );
    const result = await fn(context, context.services, context.vars, context.args, context.tags);
    if (typeof result === 'string' && ['success', 'failure', 'true', 'false'].includes(result)) {
      return result as FlowNodeOutcome;
    }
    return DEFAULT_OUTCOME;
  },
};

function renderTemplate(template: string, context: FlowExecutionContext): string {
  const scope = {
    args: context.args,
    tags: context.tags,
    vars: context.vars,
    lastOutput: context.lastOutput ?? '',
  };
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, token) => {
    try {
      const normalized = token.trim().replace(/\]/g, '');
      const path = normalized.split(/[\.\[]/).filter(Boolean);
      let value: any = scope;
      for (const segment of path) {
        value = value?.[segment];
      }
      return value ?? '';
    } catch {
      return '';
    }
  });
}

function buildEdges(flow: FlowGraph) {
  const map = new Map<string, FlowEdge[]>();
  for (const edge of flow.edges) {
    const list = map.get(edge.source) ?? [];
    list.push(edge);
    map.set(edge.source, list);
  }
  return map;
}

function makeKey(node: FlowNode): string {
  return `${node.type}:${node.subtype ?? 'default'}`;
}

function shouldTraverse(edge: FlowEdge, outcome: FlowNodeOutcome) {
  const condition = edge.conditions?.outcome;
  if (!condition) return true;
  if (Array.isArray(condition)) {
    return condition.includes(outcome);
  }
  return condition === outcome;
}

export async function runFlowGraph(
  flow: FlowGraph,
  context: FlowExecutionContext
) {
  const nodeMap = new Map(flow.nodes.map((node) => [node.id, node]));
  const edges = buildEdges(flow);
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const node of flow.nodes) {
    if (node.type === 'trigger') {
      queue.push(node.id);
    }
  }

  if (queue.length === 0 && flow.nodes.length) {
    queue.push(flow.nodes[0].id);
  }

  context.logEvent?.({
    type: 'flow-start',
    message: `Flow started with ${flow.nodes.length} nodes.`,
    timestamp: Date.now(),
  });

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const handler = nodeExecutors[makeKey(node)];
    if (!handler) {
      console.warn(`[Flow] No handler for node ${node.id} (${node.type}). Skipping.`);
      continue;
    }

    if (visited.has(nodeId) && visited.size > flow.nodes.length * 4) {
      console.warn(`[Flow] Potential loop detected near node ${node.id}.`);
      break;
    }

    context.logEvent?.({
      type: 'node-start',
      message: `Executing node "${node.label}"`,
      nodeId: node.id,
      label: node.label,
      timestamp: Date.now(),
    });

    let outcome: FlowNodeOutcome = DEFAULT_OUTCOME;
    try {
      outcome = await handler(node, context);
      context.logEvent?.({
        type: 'node-complete',
        message: `Node "${node.label}" completed with outcome ${outcome}`,
        nodeId: node.id,
        label: node.label,
        outcome,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      context.logEvent?.({
        type: 'node-error',
        message: `Node "${node.label}" failed: ${error?.message || error}`,
        nodeId: node.id,
        label: node.label,
        error: error?.stack || error?.message || String(error),
        timestamp: Date.now(),
      });
      throw error;
    }

    const outgoing = edges.get(nodeId) ?? [];
    for (const edge of outgoing) {
      if (!shouldTraverse(edge, outcome)) continue;
      if (!visited.has(edge.target)) {
        queue.push(edge.target);
      }
    }
    visited.add(nodeId);
  }

  context.logEvent?.({
    type: 'flow-complete',
    message: 'Flow completed.',
    timestamp: Date.now(),
  });
}

export function defaultFlowServices(): Services {
  return {
    sendChatMessage,
    sendDiscordMessage: (channelId: string, message: string) =>
      sendDiscordMessage(channelId, message),
    conversationalResponse,
    textToSpeech,
    broadcast: (payload: any) => {
      (global as any).broadcast?.(payload);
    },
    sendPluginCommand: async (pluginId, command) => {
      const { sendPluginCommand } = await import('@/plugins');
      await sendPluginCommand(pluginId, command);
    },
    updatePoints: async ({ user, amount = 0, operation = 'add' }) => {
      switch (operation) {
        case 'set':
          return setPoints(user, amount);
        case 'get':
          return fetchPoints(user);
        case 'add':
        default:
          return addPoints(user, amount);
      }
    },
    getPoints: (user: string) => fetchPoints(user),
    getLeaderboard: (limit?: number) => fetchLeaderboard(limit ?? 10),
  };
}

export type { FlowExecutionContext } from '@/types/flows-runtime';


