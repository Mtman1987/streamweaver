import { promises as fsp } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import type { Action, ActionQueue, Command } from './types';
import type { AutomationEngine } from './AutomationEngine';

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function loadAutomationFromStreamWeaver(
  engine: AutomationEngine,
  actionsDir: string,
  commandsDir: string
): Promise<{ commandsLoaded: number; actionsLoaded: number; queuesLoaded: number }> {
  const commands: Command[] = [];
  const actions: Action[] = [];

  // Load commands
  try {
    const commandFiles = await fsp.readdir(commandsDir);
    const jsonFiles = commandFiles.filter(f => f.endsWith('.json') && f !== '_metadata.json');
    
    for (const file of jsonFiles) {
      const filePath = path.join(commandsDir, file);
      const content = await fsp.readFile(filePath, 'utf-8');
      const command = JSON.parse(content);
      commands.push(command);
    }
  } catch (error) {
    console.warn('Failed to load commands:', error);
  }

  // Load actions
  try {
    const actionFiles = await fsp.readdir(actionsDir);
    const jsonFiles = actionFiles.filter(f => f.endsWith('.json') && f !== '_metadata.json');
    
    for (const file of jsonFiles) {
      const filePath = path.join(actionsDir, file);
      const content = await fsp.readFile(filePath, 'utf-8');
      const action = JSON.parse(content);
      actions.push(action);
    }
  } catch (error) {
    console.warn('Failed to load actions:', error);
  }

  // Reset and load
  const commandManager = engine.getCommandManager() as unknown as { reset?: () => void; createCommand: (c: Command) => any };
  const actionManager = engine.getActionManager() as unknown as { reset?: () => void; createAction: (a: Action) => any };

  commandManager.reset?.();
  actionManager.reset?.();

  for (const command of commands) {
    console.log(`[StreamWeaver Loader] Loading command: ${command.name} (${command.command}) - ID: ${command.id}`);
    commandManager.createCommand(command);
  }

  for (const action of actions) {
    console.log(`[StreamWeaver Loader] Loading action: ${action.name} (ID: ${action.id})`);
    actionManager.createAction(action);
  }

  return {
    commandsLoaded: commands.length,
    actionsLoaded: actions.length,
    queuesLoaded: 0,
  };
}

export function watchStreamWeaverFiles(
  actionsDir: string,
  commandsDir: string,
  onChange: () => void
): () => void {
  const throttleMs = 400;
  let timeout: NodeJS.Timeout | null = null;
  const watchers: fs.FSWatcher[] = [];

  const schedule = () => {
    if (timeout) return;
    timeout = setTimeout(() => {
      timeout = null;
      onChange();
    }, throttleMs);
  };

  const dirs = [actionsDir, commandsDir];
  
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      watchers.push(fs.watch(dir, { recursive: true }, schedule));
    } catch {
      // Ignore watcher errors
    }
  }

  return () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    watchers.forEach((w) => w.close());
  };
}