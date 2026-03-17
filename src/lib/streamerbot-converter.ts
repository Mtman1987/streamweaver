/**
 * Streamer.bot JSON Converter
 * Converts Streamer.bot actions and commands to StreamWeaver format
 */

export interface StreamerbotAction {
  id: string;
  name: string;
  enabled: boolean;
  group?: string;
  triggers?: any[];
  subactions?: any[];
  [key: string]: any;
}

export interface StreamerbotCommand {
  id: string;
  name: string;
  enabled: boolean;
  command: string;
  group?: string;
  permittedUsers?: string[];
  permittedGroups?: string[];
  sources?: number;
  globalCooldown?: number;
  userCooldown?: number;
  caseSensitive?: boolean;
  mode?: number;
  regexExplicitCapture?: boolean;
  [key: string]: any;
}

export interface StreamWeaverAction {
  id: string;
  name: string;
  description?: string;
  triggers: Array<{
    type: string;
    config: Record<string, any>;
  }>;
  subActions: Array<{
    id: string;
    type: string;
    name: string;
    config: Record<string, any>;
    enabled: boolean;
    order: number;
  }>;
  enabled: boolean;
  concurrent: boolean;
  queue: boolean;
  group?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StreamWeaverCommand {
  id: string;
  name: string;
  command: string;
  enabled: boolean;
  description?: string;
  aliases?: string[];
  permissions?: string[];
  cooldown?: {
    global?: number;
    user?: number;
  };
  caseSensitive?: boolean;
  regex?: boolean;
  group?: string;
  sources?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Convert Streamer.bot action to StreamWeaver format
 */
export function convertStreamerbotAction(
  sbAction: StreamerbotAction
): StreamWeaverAction {
  const now = new Date().toISOString();

  // Convert subactions
  const subActions = (sbAction.subactions || []).map((subaction: any, index: number) => ({
    id: subaction.id || `subaction-${index}`,
    type: mapStreamerbotSubactionType(subaction.$type || subaction.type),
    name: subaction.name || `SubAction ${index + 1}`,
    config: convertSubactionConfig(subaction),
    enabled: subaction.enabled !== false,
    order: index,
  }));

  // Convert triggers
  const triggers = (sbAction.triggers || []).map((trigger: any) => ({
    type: mapStreamerbotTriggerType(trigger.type || trigger.$type),
    config: trigger.config || {},
  }));

  return {
    id: sbAction.id,
    name: sbAction.name,
    description: sbAction.description || `Imported from Streamer.bot: ${sbAction.name}`,
    triggers,
    subActions,
    enabled: sbAction.enabled !== false,
    concurrent: false,
    queue: false,
    group: sbAction.group,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Convert Streamer.bot command to StreamWeaver format
 */
export function convertStreamerbotCommand(
  sbCommand: StreamerbotCommand
): StreamWeaverCommand {
  const now = new Date().toISOString();

  // Parse command string - could have multiple aliases separated by newlines
  const commands = sbCommand.command?.split(/[\r\n]+/).filter(Boolean) || [];
  const mainCommand = commands[0] || '';
  const aliases = commands.slice(1);

  // Map permission groups to StreamWeaver format
  const permissions: string[] = [];
  if (sbCommand.permittedGroups?.includes('Moderators')) {
    permissions.push('moderator');
  }
  if (sbCommand.permittedGroups?.includes('Subscribers')) {
    permissions.push('subscriber');
  }
  if (sbCommand.permittedGroups?.includes('VIP')) {
    permissions.push('vip');
  }
  if (sbCommand.permittedUsers && sbCommand.permittedUsers.length > 0) {
    permissions.push('broadcaster');
  }

  return {
    id: sbCommand.id,
    name: sbCommand.name,
    command: mainCommand,
    enabled: sbCommand.enabled !== false,
    description: `Imported from Streamer.bot: ${sbCommand.name}`,
    aliases: aliases.length > 0 ? aliases : undefined,
    permissions: permissions.length > 0 ? permissions : undefined,
    cooldown: {
      global: sbCommand.globalCooldown || 0,
      user: sbCommand.userCooldown || 0,
    },
    caseSensitive: sbCommand.caseSensitive || false,
    regex: sbCommand.mode === 1, // mode 1 = regex
    group: sbCommand.group,
    sources: sbCommand.sources,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Map Streamer.bot subaction types to StreamWeaver types
 */
function mapStreamerbotSubactionType(type: string): string {
  const typeMap: Record<string, string> = {
    'SendChatMessage': 'Send Chat Message',
    'TwitchChatMessage': 'Send Chat Message',
    'PlaySound': 'Play Sound',
    'PlaySoundFromFolder': 'Play Sound',
    'ObsSetScene': 'OBS Set Scene',
    'ObsSetSourceVisibility': 'OBS Toggle Source',
    'ObsSetFilterState': 'OBS Toggle Filter',
    'Delay': 'Delay',
    'Wait': 'Delay',
    'RunAction': 'Execute Action',
    'ExecuteCode': 'Execute Code',
    'CSharpCode': 'Execute Code',
    'SetArgument': 'Set Variable',
    'SetGlobalVariable': 'Set Variable',
    'TwitchRewardUpdate': 'Update Channel Points',
    'TwitchClip': 'Create Clip',
    'Discord': 'Send Discord Message',
    'DiscordMessage': 'Send Discord Message',
  };

  return typeMap[type] || 'Execute Code';
}

/**
 * Map Streamer.bot trigger types to StreamWeaver types
 */
function mapStreamerbotTriggerType(type: string): string {
  const typeMap: Record<string, string> = {
    'TwitchFollow': 'Follow',
    'TwitchSubscription': 'Subscription',
    'TwitchReSub': 'Resubscription',
    'TwitchGiftSub': 'Gift Subscription',
    'TwitchRaid': 'Raid',
    'TwitchCheer': 'Cheer',
    'TwitchReward': 'Channel Points',
    'Command': 'Chat Command',
    'ChatMessage': 'Chat Message',
    'Timer': 'Timer',
    'Hotkey': 'Hotkey',
    'Discord': 'Discord Message',
  };

  return typeMap[type] || 'Chat Command';
}

/**
 * Convert subaction config from Streamer.bot format
 */
function convertSubactionConfig(subaction: any): Record<string, any> {
  const config: Record<string, any> = {};

  // Common mappings
  if (subaction.message) config.message = subaction.message;
  if (subaction.fileName) config.soundFile = subaction.fileName;
  if (subaction.volume !== undefined) config.volume = subaction.volume / 100; // SB uses 0-100
  if (subaction.sceneName) config.sceneName = subaction.sceneName;
  if (subaction.sourceName) config.sourceName = subaction.sourceName;
  if (subaction.duration) config.duration = subaction.duration;
  if (subaction.code) config.code = subaction.code;
  if (subaction.actionName) config.actionName = subaction.actionName;
  if (subaction.variableName) config.variableName = subaction.variableName;
  if (subaction.value) config.value = subaction.value;

  // Copy any other properties that might be useful
  Object.keys(subaction).forEach((key) => {
    if (
      !['id', 'name', 'enabled', '$type', 'type'].includes(key) &&
      !config[key]
    ) {
      config[key] = subaction[key];
    }
  });

  return config;
}

/**
 * Import Streamer.bot actions JSON file
 */
export function importStreamerbotActions(
  actionsData: any
): StreamWeaverAction[] {
  const actions = actionsData.actions || actionsData.Actions || actionsData || [];
  
  if (!Array.isArray(actions)) {
    console.warn('Invalid actions format, expected array');
    return [];
  }

  return actions.map(convertStreamerbotAction);
}

/**
 * Import Streamer.bot commands JSON file
 */
export function importStreamerbotCommands(
  commandsData: any
): StreamWeaverCommand[] {
  const commands = commandsData.commands || commandsData.Commands || commandsData || [];
  
  if (!Array.isArray(commands)) {
    console.warn('Invalid commands format, expected array');
    return [];
  }

  return commands.map(convertStreamerbotCommand);
}

/**
 * Merge imported actions with existing actions, avoiding duplicates
 */
export function mergeActions(
  existing: StreamWeaverAction[],
  imported: StreamWeaverAction[]
): StreamWeaverAction[] {
  const existingIds = new Set(existing.map((a) => a.id));
  const merged = [...existing];

  imported.forEach((action) => {
    if (!existingIds.has(action.id)) {
      merged.push(action);
    } else {
      console.warn(`Skipping duplicate action: ${action.name} (${action.id})`);
    }
  });

  return merged;
}

/**
 * Merge imported commands with existing commands, avoiding duplicates
 */
export function mergeCommands(
  existing: StreamWeaverCommand[],
  imported: StreamWeaverCommand[]
): StreamWeaverCommand[] {
  const existingIds = new Set(existing.map((c) => c.id));
  const merged = [...existing];

  imported.forEach((command) => {
    if (!existingIds.has(command.id)) {
      merged.push(command);
    } else {
      console.warn(`Skipping duplicate command: ${command.name} (${command.id})`);
    }
  });

  return merged;
}
