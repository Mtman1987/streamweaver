import { promises as fsp } from 'fs';
import * as path from 'path';
import { tenantPath } from './tenant';

function actionsDir(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'actions');
  return path.resolve(process.cwd(), 'actions');
}

function commandsDir(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'commands');
  return path.resolve(process.cwd(), 'commands');
}

// Legacy exports for backward compat
export const ACTIONS_DIR_PATH = path.resolve(process.cwd(), 'actions');
export const COMMANDS_DIR_PATH = path.resolve(process.cwd(), 'commands');

export type StreamWeaverCommandsFile = Record<string, any> & { commands?: any[] };
export type StreamWeaverActionsFile = Record<string, any> & { actions?: any[] };

export async function readStreamWeaverCommands(tenantId?: string): Promise<StreamWeaverCommandsFile> {
  const commands: any[] = [];
  const dir = commandsDir(tenantId);

  try {
    const files = await fsp.readdir(dir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '_metadata.json');

    for (const file of jsonFiles) {
      const content = await fsp.readFile(path.join(dir, file), 'utf-8');
      commands.push(JSON.parse(content));
    }
  } catch (error) {
    console.warn('Failed to read commands directory:', error);
  }

  return { version: 1, commands };
}

export async function readStreamWeaverActions(tenantId?: string): Promise<StreamWeaverActionsFile> {
  const actions: any[] = [];
  const dir = actionsDir(tenantId);

  try {
    const files = await fsp.readdir(dir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '_metadata.json');

    for (const file of jsonFiles) {
      const content = await fsp.readFile(path.join(dir, file), 'utf-8');
      actions.push(JSON.parse(content));
    }
  } catch (error) {
    console.warn('Failed to read actions directory:', error);
  }

  return { version: 1, actions, queues: [] };
}
