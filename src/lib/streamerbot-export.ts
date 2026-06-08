import { randomUUID } from 'crypto';
import { parseFlowPackage, type FlowPackage } from '@/lib/flow-packages';

type StreamerbotExportCommand = {
  id: string;
  name: string;
  enabled: boolean;
  command: string;
  group?: string;
  permittedGroups?: string[];
  globalCooldown?: number;
  userCooldown?: number;
  caseSensitive?: boolean;
  mode?: number;
};

type StreamerbotExportAction = {
  id: string;
  name: string;
  enabled: boolean;
  group?: string;
  triggers: Array<{ type: string; [key: string]: any }>;
  subactions: Array<Record<string, any>>;
};

type StreamerbotExportTrigger = { type: string; [key: string]: any };

type StreamerbotPackageExport = {
  format: 'streamerbot-package';
  version: 1;
  packageId: string;
  name: string;
  generatedAt: string;
  commands: StreamerbotExportCommand[];
  actions: StreamerbotExportAction[];
  warnings: string[];
  summary: {
    commands: number;
    actions: number;
    supportedSubactions: number;
    fallbackSubactions: number;
  };
};

const subActionReverseMap: Record<string, string> = {
  'Send Chat Message': 'SendChatMessage',
  'Play Sound': 'PlaySound',
  'OBS Set Scene': 'ObsSetScene',
  'OBS Toggle Source': 'ObsSetSourceVisibility',
  'OBS Toggle Filter': 'ObsSetFilterState',
  'Delay': 'Delay',
  'Execute Action': 'RunAction',
  'Execute Code': 'ExecuteCode',
  'Set Variable': 'SetGlobalVariable',
  'Update Channel Points': 'TwitchRewardUpdate',
  'Create Clip': 'TwitchClip',
  'Send Discord Message': 'DiscordMessage',
};

const triggerReverseMap: Record<string, string> = {
  'Chat Command': 'Command',
  'Command': 'Command',
  'Chat Message': 'ChatMessage',
  'Follow': 'TwitchFollow',
  'Subscription': 'TwitchSubscription',
  'Resubscription': 'TwitchReSub',
  'Gift Subscription': 'TwitchGiftSub',
  'Raid': 'TwitchRaid',
  'Cheer': 'TwitchCheer',
  'Channel Points': 'TwitchReward',
  'Timer': 'Timer',
  'Hotkey': 'Hotkey',
  'Discord Message': 'Discord',
};

function toPermittedGroups(permissions: unknown): string[] | undefined {
  if (!Array.isArray(permissions)) return undefined;
  const groups = permissions.flatMap((permission) => {
    switch (String(permission)) {
      case 'moderator':
        return ['Moderators'];
      case 'subscriber':
        return ['Subscribers'];
      case 'vip':
        return ['VIP'];
      case 'broadcaster':
        return ['Broadcaster'];
      default:
        return [];
    }
  });

  return groups.length > 0 ? [...new Set(groups)] : undefined;
}

function exportCommand(command: Record<string, any>): StreamerbotExportCommand {
  const aliases = Array.isArray(command.aliases) ? command.aliases.filter(Boolean) : [];
  return {
    id: String(command.id || command.command || command.name || randomUUID()),
    name: String(command.name || command.command || 'Imported Command'),
    enabled: command.enabled !== false,
    command: [String(command.command || '').trim(), ...aliases.map((alias: string) => String(alias).trim())].filter(Boolean).join('\n'),
    group: command.group ? String(command.group) : undefined,
    permittedGroups: toPermittedGroups(command.permissions),
    globalCooldown: Number(command.cooldown?.global || 0),
    userCooldown: Number(command.cooldown?.user || 0),
    caseSensitive: Boolean(command.caseSensitive),
    mode: command.regex ? 1 : 0,
  };
}

function buildFallbackCode(subAction: Record<string, any>): string {
  const payload = JSON.stringify({
    type: subAction.type,
    name: subAction.name,
    config: subAction.config || {},
  }, null, 2);

  return [
    '// StreamWeaver fallback block',
    '// Replace this stub with Streamer.bot-compatible C# logic if needed.',
    `// Original block payload:`,
    payload,
  ].join('\n');
}

function exportSubAction(
  subAction: Record<string, any>,
  warnings: string[],
  counters: { supportedSubactions: number; fallbackSubactions: number }
): Record<string, any> {
  const sourceType = String(subAction.type || '');
  const mappedType = subActionReverseMap[sourceType];
  if (mappedType) {
    counters.supportedSubactions += 1;
    return {
      id: subAction.id,
      name: subAction.name || sourceType,
      enabled: subAction.enabled !== false,
      $type: mappedType,
      ...Object.fromEntries(Object.entries(subAction.config || {})),
    };
  }

  counters.fallbackSubactions += 1;
  warnings.push(`Unsupported StreamWeaver subaction "${sourceType}" exported as ExecuteCode fallback.`);
  return {
    id: subAction.id,
    name: subAction.name || sourceType || 'Unsupported block',
    enabled: subAction.enabled !== false,
    $type: 'ExecuteCode',
    language: 'C#',
    code: buildFallbackCode(subAction),
  };
}

function exportTrigger(trigger: Record<string, any>, warnings: string[]): StreamerbotExportTrigger {
  const sourceType = String(trigger.type || '');
  const mappedType = triggerReverseMap[sourceType];
  if (!mappedType) {
    warnings.push(`Unsupported trigger "${sourceType}" exported as generic Command trigger.`);
  }

  return {
    type: mappedType || 'Command',
    ...(trigger.config && typeof trigger.config === 'object' ? { config: trigger.config } : {}),
    ...(trigger.pattern ? { pattern: trigger.pattern } : {}),
  };
}

function appendCommandTriggers(
  actionMap: Map<string, StreamerbotExportAction>,
  pkg: FlowPackage,
  warnings: string[]
): void {
  for (const command of pkg.commands) {
    const commandText = String(command.command || '').trim();
    const actionId = command.actionId ? String(command.actionId) : '';
    if (!commandText || !actionId) continue;
    const action = actionMap.get(actionId);
    if (!action) {
      warnings.push(`Command "${commandText}" references an action that was not included in the export.`);
      continue;
    }

    const hasCommandTrigger = action.triggers.some((trigger) => {
      const triggerCommand = String(trigger?.config?.command || trigger?.pattern || '').trim().toLowerCase();
      return trigger.type === 'Command' && triggerCommand === commandText.toLowerCase();
    });

    if (!hasCommandTrigger) {
      action.triggers.unshift({
        type: 'Command',
        config: { command: commandText },
      });
    }
  }
}

export function exportFlowPackageToStreamerbot(input: FlowPackage): StreamerbotPackageExport {
  const pkg = parseFlowPackage(input);
  const warnings: string[] = [];
  const counters = { supportedSubactions: 0, fallbackSubactions: 0 };

  const commands = pkg.commands.map(exportCommand);
  const actions: StreamerbotExportAction[] = pkg.actions.map((action) => ({
    id: String(action.id || `${action.name}:${action.group || ''}`),
    name: String(action.name || 'Imported Action'),
    enabled: action.enabled !== false,
    group: action.group ? String(action.group) : undefined,
    triggers: Array.isArray(action.triggers)
      ? action.triggers.map((trigger) => exportTrigger(trigger, warnings))
      : [],
    subactions: Array.isArray(action.subActions)
      ? action.subActions.map((subAction) => exportSubAction(subAction, warnings, counters))
      : [],
  }));

  appendCommandTriggers(new Map(actions.map((action) => [action.id, action])), pkg, warnings);

  return {
    format: 'streamerbot-package',
    version: 1,
    packageId: pkg.packageId,
    name: pkg.name,
    generatedAt: new Date().toISOString(),
    commands,
    actions,
    warnings: [...new Set(warnings)],
    summary: {
      commands: commands.length,
      actions: actions.length,
      supportedSubactions: counters.supportedSubactions,
      fallbackSubactions: counters.fallbackSubactions,
    },
  };
}
