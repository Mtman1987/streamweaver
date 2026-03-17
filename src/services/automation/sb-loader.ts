import { promises as fsp } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import type { Action, ActionQueue, Command } from './types';
import type { AutomationEngine } from './AutomationEngine';

type SbCommandsFile = {
  commands?: unknown;
  Commands?: unknown;
};

type SbActionsFile = {
  actions?: unknown;
  Actions?: unknown;
  queues?: unknown;
  Queues?: unknown;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function loadAutomationFromSbDir(
  engine: AutomationEngine,
  sbDir: string
): Promise<{ commandsLoaded: number; actionsLoaded: number; queuesLoaded: number }> {
  const commandsPath = path.join(sbDir, 'commands.json');
  const actionsPath = path.join(sbDir, 'actions.json');

  const [commandsRaw, actionsRaw] = await Promise.all([
    fsp.readFile(commandsPath, 'utf-8'),
    fsp.readFile(actionsPath, 'utf-8'),
  ]);

  const commandsJson = JSON.parse(commandsRaw) as SbCommandsFile | unknown;
  const actionsJson = JSON.parse(actionsRaw) as SbActionsFile | unknown;

  const commands = asArray<Command>((commandsJson as any)?.commands ?? (commandsJson as any)?.Commands ?? commandsJson);
  const actions = asArray<Action>((actionsJson as any)?.actions ?? (actionsJson as any)?.Actions ?? actionsJson);
  const queues = asArray<ActionQueue>((actionsJson as any)?.queues ?? (actionsJson as any)?.Queues ?? []);

  // Reset and load
  // Some builds may have older type info; use a safe cast for reset().
  const commandManager = engine.getCommandManager() as unknown as { reset?: () => void; createCommand: (c: Command) => any };
  const actionManager = engine.getActionManager() as unknown as { reset?: () => void; createAction: (a: Action) => any };

  commandManager.reset?.();
  actionManager.reset?.();

  for (const command of commands) {
    commandManager.createCommand(command);
  }

  for (const action of actions) {
    actionManager.createAction(action);
  }

  return {
    commandsLoaded: commands.length,
    actionsLoaded: actions.length,
    queuesLoaded: queues.length,
  };
}

export function watchSbAutomationFiles(
  sbDir: string,
  onChange: () => void
): () => void {
  const throttleMs = 400;
  let timeout: NodeJS.Timeout | null = null;

  const files = [path.join(sbDir, 'commands.json'), path.join(sbDir, 'actions.json')];
  const watchers: fs.FSWatcher[] = [];

  const schedule = () => {
    if (timeout) return;
    timeout = setTimeout(() => {
      timeout = null;
      onChange();
    }, throttleMs);
  };

  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      watchers.push(fs.watch(file, schedule));
    } catch {
      // Ignore watcher errors; runtime will still work without hot reload.
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
