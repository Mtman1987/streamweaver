import { promises as fsp } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { readSbCommandsFile, writeSbCommandsFile } from './sb-store';
import { tenantPath } from './tenant';
import type { Command } from '../services/automation/types';

// Root commands directory (used as template for new tenants)
const ROOT_COMMANDS_DIR = path.join(process.cwd(), 'commands');

function getCommandsDir(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'commands');
  return ROOT_COMMANDS_DIR;
}

function loadCommandsFromDir(dir: string): any[] {
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir);
  const commands: any[] = [];

  for (const file of files) {
    if (file.endsWith('.json') && file !== '_metadata.json') {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        const command = JSON.parse(content);
        commands.push(command);
      } catch (e) {
        console.warn(`Failed to load command file ${file}:`, e);
      }
    }
  }

  return commands;
}

function mergeCommands(base: any[], overrides: any[]): any[] {
  const merged = new Map<string, any>();

  for (const command of base) {
    const key = String(command?.id || command?.command || '').trim().toLowerCase();
    if (!key) continue;
    merged.set(key, command);
  }

  for (const command of overrides) {
    const key = String(command?.id || command?.command || '').trim().toLowerCase();
    if (!key) continue;
    merged.set(key, command);
  }

  return Array.from(merged.values());
}

export const COMMANDS_FILE_PATH = path.resolve(process.cwd(), 'src', 'data', 'commands.json');

export interface CommandDTO {
  id: string;
  name: string;
  enabled: boolean;
  command: string;
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

type LegacyCommandShape = {
  id?: string;
  name?: string;
  trigger?: string;
  response?: string;
  enabled?: boolean;
  cooldown?: number;
  createdAt?: string;
  updatedAt?: string;
};

type ImportedCommandShape = {
  id?: string;
  name?: string;
  command?: string;
  enabled?: boolean;
  description?: string;
  aliases?: string[];
  permissions?: string[];
  cooldown?: { global?: number; user?: number };
  caseSensitive?: boolean;
  regex?: boolean;
  group?: string;
  sources?: number;
  createdAt?: string;
  updatedAt?: string;
};

async function ensureCommandsFile(): Promise<void> {
  try {
    await fsp.access(COMMANDS_FILE_PATH);
  } catch {
    await fsp.mkdir(path.dirname(COMMANDS_FILE_PATH), { recursive: true });
    await fsp.writeFile(COMMANDS_FILE_PATH, JSON.stringify([], null, 2));
  }
}

function normalizeCommand(c: any): CommandDTO {
  const now = new Date().toISOString();
  const cmd = (c?.command ?? '').toString().trim();
  const name = (c?.name ?? '').toString().trim() || cmd;
  return {
    id: (c?.id ?? randomUUID()).toString(),
    name: name || 'Untitled Command',
    enabled: c?.enabled ?? true,
    command: cmd || 'command',
    description: typeof c?.description === 'string' ? c.description : undefined,
    aliases: Array.isArray(c?.aliases) ? c.aliases : undefined,
    permissions: Array.isArray(c?.permissions) ? c.permissions : undefined,
    cooldown: {
      global: Number(c?.globalCooldown ?? c?.cooldown?.global ?? 0) || 0,
      user: Number(c?.userCooldown ?? c?.cooldown?.user ?? 0) || 0,
    },
    caseSensitive: c?.caseSensitive ?? false,
    regex: (c?.mode ?? 0) === 1 || c?.regex === true,
    group: typeof c?.group === 'string' ? c.group : undefined,
    sources: typeof c?.sources === 'number' ? c.sources : undefined,
    createdAt: c?.createdAt ?? now,
    updatedAt: c?.updatedAt ?? now,
  };
}

// Save command to individual file
async function saveCommandToFile(command: any, tenantId?: string): Promise<void> {
  const dir = getCommandsDir(tenantId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = `${command.command.replace(/[^a-zA-Z0-9]/g, '_')}_${command.id}.json`;
  const filepath = path.join(dir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(command, null, 2));

  if (command?.id) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json') || file === '_metadata.json') continue;
      const candidate = path.join(dir, file);
      if (candidate !== filepath && file.includes(String(command.id))) {
        fs.unlinkSync(candidate);
      }
    }
  }
}

// Export command for sharing
export async function exportCommand(id: string, tenantId?: string): Promise<string | null> {
  const command = await getCommandById(id, tenantId);
  return command ? JSON.stringify(command, null, 2) : null;
}

// Import command from JSON
export async function importCommand(commandJson: string, tenantId?: string): Promise<Command> {
  const command = JSON.parse(commandJson);
  command.id = randomUUID(); // Generate new ID to avoid conflicts
  await saveCommandToFile(command, tenantId);
  return command as Command;
}

export async function getAllCommands(tenantId?: string): Promise<CommandDTO[]> {
  // Prefer shared root command files, then overlay any tenant-specific overrides.
  if (tenantId) {
    const rootCommands = loadCommandsFromDir(ROOT_COMMANDS_DIR);
    const tenantCommands = loadCommandsFromDir(getCommandsDir(tenantId));
    const merged = mergeCommands(rootCommands, tenantCommands);
    if (merged.length > 0) {
      return merged as any;
    }
  } else {
    const rootCommands = loadCommandsFromDir(ROOT_COMMANDS_DIR);
    if (rootCommands.length > 0) {
      return rootCommands as any;
    }
  }
  
  // Fallback to monolithic file
  try {
    const sb = await readSbCommandsFile();
    const sbCommands = Array.isArray(sb.commands) ? sb.commands : [];
    return sbCommands.map(normalizeCommand);
  } catch {
    return readCommands();
  }
}

export type CreateCommandInput = {
  name: string;
  command: string;
  group?: string;
  enabled?: boolean;
} & Partial<Command> & Record<string, any>;

export async function createCommand(input: CreateCommandInput, tenantId?: string): Promise<Command> {
  const now = new Date().toISOString();
  const id = String((input as any).id || randomUUID());
  const cooldown = (input.cooldown && typeof input.cooldown === 'object' ? input.cooldown : {}) as any;
  const next: Command = {
    ...(input as any),
    id,
    name: input.name.trim() || input.command.trim(),
    enabled: input.enabled ?? true,
    command: input.command.trim(),
    mode: input.mode ?? (input.regex ? 1 : 0),
    location: input.location ?? 0,
    ignoreBotAccount: input.ignoreBotAccount ?? false,
    ignoreInternal: input.ignoreInternal ?? false,
    sources: input.sources ?? 1,
    persistCounter: input.persistCounter ?? false,
    persistUserCounter: input.persistUserCounter ?? false,
    caseSensitive: input.caseSensitive ?? false,
    globalCooldown: Number(input.globalCooldown ?? cooldown.global ?? 0) || 0,
    userCooldown: Number(input.userCooldown ?? cooldown.user ?? 0) || 0,
    group: input.group?.trim() || undefined,
    grantType: input.grantType ?? 0,
    permittedUsers: Array.isArray(input.permittedUsers) ? input.permittedUsers : [],
    permittedGroups: Array.isArray(input.permittedGroups) ? input.permittedGroups : [],
  };

  const commandWithTimestamps = {
    ...next,
    createdAt: now,
    updatedAt: now,
  };

  await saveCommandToFile(commandWithTimestamps, tenantId);
  return next;
}

export async function duplicateCommand(id: string, tenantId?: string): Promise<Command | null> {
  const current = await getCommandById(id, tenantId);
  if (!current) return null;

  const baseCommand = String((current as any).command || '!command');
  const copyCommand = `${baseCommand}-copy`;
  return createCommand({
    ...(current as any),
    id: undefined,
    name: `${current.name || baseCommand} Copy`,
    command: copyCommand.startsWith('!') ? copyCommand : `!${copyCommand}`,
    enabled: false,
  } as any, tenantId);
}

export async function replaceCommands(commands: any[], tenantId?: string): Promise<number> {
  const dir = getCommandsDir(tenantId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.json') && file !== '_metadata.json') {
      fs.unlinkSync(path.join(dir, file));
    }
  }

  let count = 0;
  const now = new Date().toISOString();
  for (const raw of commands) {
    if (!raw || typeof raw !== 'object') continue;
    const commandText = String((raw as any).command || (raw as any).trigger || '').trim();
    if (!commandText) continue;
    const next = {
      ...(raw as any),
      id: String((raw as any).id || randomUUID()),
      name: String((raw as any).name || commandText),
      command: commandText,
      enabled: (raw as any).enabled ?? true,
      createdAt: (raw as any).createdAt ?? now,
      updatedAt: (raw as any).updatedAt ?? now,
    };
    await saveCommandToFile(next, tenantId);
    count += 1;
  }
  return count;
}

export async function updateCommand(id: string, updates: Partial<CreateCommandInput>, tenantId?: string): Promise<Command | null> {
  const current = await getCommandById(id, tenantId);
  if (!current) return null;
  const definedUpdates = Object.fromEntries(
    Object.entries(updates as any).filter(([, value]) => value !== undefined)
  );

  const next = {
    ...current,
    ...definedUpdates,
    ...(updates.name != null ? { name: updates.name } : {}),
    ...(updates.command != null ? { command: updates.command } : {}),
    ...(updates.group != null ? { group: updates.group } : {}),
    ...(updates.enabled != null ? { enabled: updates.enabled } : {}),
    updatedAt: new Date().toISOString(),
  };

  await saveCommandToFile(next, tenantId);
  return next as Command;
}

export async function updateAllCommandsEnabled(enabled: boolean, tenantId?: string): Promise<number> {
  const dir = getCommandsDir(tenantId);
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    let updatedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.json') || file === '_metadata.json') continue;

      const filepath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filepath, 'utf8');
        const command = JSON.parse(content);
        if (command?.enabled === enabled) continue;

        const next = {
          ...command,
          enabled,
          updatedAt: new Date().toISOString(),
        };

        fs.writeFileSync(filepath, JSON.stringify(next, null, 2));
        updatedCount += 1;
      } catch (e) {
        console.warn(`Failed to update command file ${file}:`, e);
      }
    }

    return updatedCount;
  }

  const file = await readSbCommandsFile();
  const commands = Array.isArray(file.commands) ? (file.commands as any[]) : [];
  let updatedCount = 0;
  const next = commands.map((command) => {
    if (command?.enabled === enabled) return command;
    updatedCount += 1;
    return {
      ...command,
      enabled,
      updatedAt: new Date().toISOString(),
    };
  });
  await writeSbCommandsFile({ ...file, commands: next });
  return updatedCount;
}

export async function getCommandById(id: string, tenantId?: string): Promise<Command | undefined> {
  const commands = await getAllCommands(tenantId);
  return commands.find((command) => String((command as any)?.id) === id) as Command | undefined;
}

export async function deleteCommand(id: string, tenantId?: string): Promise<boolean> {
  const dir = getCommandsDir(tenantId);
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    const file = files.find(f => f.includes(id) && f.endsWith('.json'));
    if (file) {
      fs.unlinkSync(path.join(dir, file));
      return true;
    }
    return false;
  }
  
  // Fallback to monolithic
  const file = await readSbCommandsFile();
  const commands = Array.isArray(file.commands) ? (file.commands as any[]) : [];
  const next = commands.filter((c) => String(c?.id) !== id);
  if (next.length === commands.length) return false;
  await writeSbCommandsFile({ ...file, commands: next });
  return true;
}

// Legacy support functions
async function readCommands(): Promise<CommandDTO[]> {
  await ensureCommandsFile();
  const data = await fsp.readFile(COMMANDS_FILE_PATH, 'utf-8');
  const parsed = JSON.parse(data) as Array<LegacyCommandShape | ImportedCommandShape>;
  return parsed.map((raw) => {
    const timestamp = new Date().toISOString();

    // Support both legacy (trigger/response) and imported Streamer.bot (command/aliases/etc.) formats.
    const maybeImported = raw as ImportedCommandShape;
    const maybeLegacy = raw as LegacyCommandShape;

    const normalizedCommandRaw =
      typeof maybeImported.command === 'string' && maybeImported.command.trim().length > 0
        ? maybeImported.command
        : (maybeLegacy.trigger ?? '').toString();
    const normalizedCommand = normalizedCommandRaw.trim();

    const normalizedNameRaw = ((maybeImported.name ?? maybeLegacy.name) ?? '').toString();
    const normalizedName = normalizedNameRaw.trim() || normalizedCommand;

    const normalizedDescription =
      typeof maybeImported.description === 'string' && maybeImported.description.trim().length > 0
        ? maybeImported.description
        : (maybeLegacy.response ?? undefined);

    return {
      id: (maybeImported.id ?? maybeLegacy.id) ?? randomUUID(),
      name: normalizedName || 'Untitled Command',
      command: normalizedCommand || 'command',
      description: normalizedDescription,
      aliases: Array.isArray(maybeImported.aliases) ? maybeImported.aliases : undefined,
      permissions: Array.isArray(maybeImported.permissions) ? maybeImported.permissions : undefined,
      cooldown:
        maybeImported.cooldown && typeof maybeImported.cooldown === 'object'
          ? {
              global: maybeImported.cooldown.global ?? 0,
              user: maybeImported.cooldown.user ?? 0,
            }
          : {
              global: maybeLegacy.cooldown ?? 0,
              user: 0,
            },
      caseSensitive: maybeImported.caseSensitive ?? false,
      regex: maybeImported.regex ?? false,
      group: maybeImported.group,
      sources: maybeImported.sources,
      enabled: (maybeImported.enabled ?? maybeLegacy.enabled) ?? true,
      createdAt: (maybeImported.createdAt ?? maybeLegacy.createdAt) ?? timestamp,
      updatedAt: (maybeImported.updatedAt ?? maybeLegacy.updatedAt) ?? timestamp,
    };
  });
}
