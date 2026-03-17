import { promises as fsp } from 'fs';
import * as path from 'path';

export const SB_DIR_PATH = path.resolve(process.cwd(), 'sb');
export const SB_COMMANDS_FILE_PATH = path.join(SB_DIR_PATH, 'commands.json');
export const SB_ACTIONS_FILE_PATH = path.join(SB_DIR_PATH, 'actions.json');

async function assertFileExists(filePath: string): Promise<void> {
  try {
    await fsp.access(filePath);
  } catch {
    const rel = path.relative(process.cwd(), filePath);
    throw new Error(`Missing required file: ${rel}`);
  }
}

async function ensureFileExists(filePath: string, defaultObject: unknown): Promise<void> {
  try {
    await fsp.access(filePath);
  } catch {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify(defaultObject, null, 2));
  }
}

export type SbCommandsFile = Record<string, any> & { commands?: any[] };
export type SbActionsFile = Record<string, any> & { actions?: any[] };

export async function ensureSbCommandsFile(): Promise<void> {
  await ensureFileExists(SB_COMMANDS_FILE_PATH, { version: 1, commands: [] });
}

export async function ensureSbActionsFile(): Promise<void> {
  await ensureFileExists(SB_ACTIONS_FILE_PATH, { version: 1, actions: [], queues: [] });
}

export async function readSbCommandsFile(): Promise<SbCommandsFile> {
  await ensureSbCommandsFile();
  await assertFileExists(SB_COMMANDS_FILE_PATH);
  const raw = await fsp.readFile(SB_COMMANDS_FILE_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid sb/commands.json: expected an object');
  }
  if (!Array.isArray((parsed as any).commands)) {
    (parsed as any).commands = [];
  }
  return parsed as SbCommandsFile;
}

export async function writeSbCommandsFile(next: SbCommandsFile): Promise<void> {
  await ensureSbCommandsFile();
  await assertFileExists(SB_COMMANDS_FILE_PATH);
  await fsp.writeFile(SB_COMMANDS_FILE_PATH, JSON.stringify(next, null, 2));
}

export async function readSbActionsFile(): Promise<SbActionsFile> {
  await ensureSbActionsFile();
  await assertFileExists(SB_ACTIONS_FILE_PATH);
  const raw = await fsp.readFile(SB_ACTIONS_FILE_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid sb/actions.json: expected an object');
  }
  if (!Array.isArray((parsed as any).actions)) {
    (parsed as any).actions = [];
  }
  return parsed as SbActionsFile;
}

export async function writeSbActionsFile(next: SbActionsFile): Promise<void> {
  await ensureSbActionsFile();
  await assertFileExists(SB_ACTIONS_FILE_PATH);
  await fsp.writeFile(SB_ACTIONS_FILE_PATH, JSON.stringify(next, null, 2));
}
