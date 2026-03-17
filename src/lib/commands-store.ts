import { promises as fsp } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { readSbCommandsFile, writeSbCommandsFile } from '@/lib/sb-store';
import type { Command } from '@/services/automation/types';

// Individual commands directory for modular storage
const COMMANDS_DIR = path.join(process.cwd(), 'commands');

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
async function saveCommandToFile(command: any): Promise<void> {
  if (!fs.existsSync(COMMANDS_DIR)) {
    fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  }
  
  const filename = `${command.command.replace(/[^a-zA-Z0-9]/g, '_')}_${command.id}.json`;
  const filepath = path.join(COMMANDS_DIR, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(command, null, 2));
}

// Export command for sharing
export async function exportCommand(id: string): Promise<string | null> {
  const command = await getCommandById(id);
  return command ? JSON.stringify(command, null, 2) : null;
}

// Import command from JSON
export async function importCommand(commandJson: string): Promise<Command> {
  const command = JSON.parse(commandJson);
  command.id = randomUUID(); // Generate new ID to avoid conflicts
  await saveCommandToFile(command);
  return command as Command;
}

export async function getAllCommands(): Promise<CommandDTO[]> {
  // Try individual files first, fall back to monolithic
  if (fs.existsSync(COMMANDS_DIR)) {
    const files = fs.readdirSync(COMMANDS_DIR);
    const commands: any[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json') && file !== '_metadata.json') {
        try {
          const content = fs.readFileSync(path.join(COMMANDS_DIR, file), 'utf8');
          const command = JSON.parse(content);
          // Preserve all fields including actionId
          commands.push(command);
        } catch (e) {
          console.warn(`Failed to load command file ${file}:`, e);
        }
      }
    }
    
    // Return raw commands with all fields preserved
    return commands as any;
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
};

export async function createCommand(input: CreateCommandInput): Promise<Command> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const next: Command = {
    id,
    name: input.name.trim() || input.command.trim(),
    enabled: input.enabled ?? true,
    command: input.command.trim(),
    mode: 0,
    location: 0,
    ignoreBotAccount: false,
    ignoreInternal: false,
    sources: 1,
    persistCounter: false,
    persistUserCounter: false,
    caseSensitive: false,
    globalCooldown: 0,
    userCooldown: 0,
    group: input.group?.trim() || undefined,
    grantType: 0,
    permittedUsers: [],
    permittedGroups: [],
  };

  const commandWithTimestamps = {
    ...next,
    createdAt: now,
    updatedAt: now,
  };

  await saveCommandToFile(commandWithTimestamps);
  return next;
}

export async function updateCommand(id: string, updates: Partial<CreateCommandInput>): Promise<Command | null> {
  const current = await getCommandById(id);
  if (!current) return null;

  const next = {
    ...current,
    ...(updates.name != null ? { name: updates.name } : {}),
    ...(updates.command != null ? { command: updates.command } : {}),
    ...(updates.group != null ? { group: updates.group } : {}),
    ...(updates.enabled != null ? { enabled: updates.enabled } : {}),
    updatedAt: new Date().toISOString(),
  };

  await saveCommandToFile(next);
  return next as Command;
}

export async function getCommandById(id: string): Promise<Command | undefined> {
  if (fs.existsSync(COMMANDS_DIR)) {
    const files = fs.readdirSync(COMMANDS_DIR);
    const file = files.find(f => f.includes(id) && f.endsWith('.json'));
    if (file) {
      try {
        const content = fs.readFileSync(path.join(COMMANDS_DIR, file), 'utf8');
        return JSON.parse(content) as Command;
      } catch (e) {
        console.warn(`Failed to load command file ${file}:`, e);
      }
    }
    return undefined;
  }
  
  // Fallback to monolithic
  const file = await readSbCommandsFile();
  const commands = Array.isArray(file.commands) ? (file.commands as any[]) : [];
  const found = commands.find((c) => String(c?.id) === id);
  return found as Command | undefined;
}

export async function deleteCommand(id: string): Promise<boolean> {
  if (fs.existsSync(COMMANDS_DIR)) {
    const files = fs.readdirSync(COMMANDS_DIR);
    const file = files.find(f => f.includes(id) && f.endsWith('.json'));
    if (file) {
      fs.unlinkSync(path.join(COMMANDS_DIR, file));
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