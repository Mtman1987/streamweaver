import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Action, SubAction, Trigger } from '@/services/automation/types';
import { readSbActionsFile, writeSbActionsFile } from '@/lib/sb-store';
import { SB_ACTIONS_FILE_PATH } from '@/lib/sb-store';

// Individual actions directory for modular storage
const ACTIONS_DIR = path.join(process.cwd(), 'actions');

// Back-compat for API routes that referenced ACTIONS_FILE_PATH.
export const ACTIONS_FILE_PATH = SB_ACTIONS_FILE_PATH;

function normalizeAction(raw: any): Action {
  const now = new Date().toISOString();
  return {
    id: (raw?.id ?? randomUUID()).toString(),
    name: (raw?.name ?? 'Untitled Action').toString(),
    enabled: raw?.enabled ?? false,
    group: typeof raw?.group === 'string' ? raw.group : undefined,
    alwaysRun: raw?.alwaysRun ?? false,
    randomAction: raw?.randomAction ?? false,
    concurrent: raw?.concurrent ?? false,
    excludeFromHistory: raw?.excludeFromHistory ?? false,
    excludeFromPending: raw?.excludeFromPending ?? false,
    queue: typeof raw?.queue === 'string' ? raw.queue : undefined,
    triggers: Array.isArray(raw?.triggers) ? (raw.triggers as Trigger[]) : [],
    subActions: Array.isArray(raw?.subActions) ? (raw.subActions as SubAction[]) : [],
    handler: raw?.handler,
    type: raw?.type,
    ...(raw?.createdAt ? { createdAt: raw.createdAt } : { createdAt: now }),
    ...(raw?.updatedAt ? { updatedAt: raw.updatedAt } : { updatedAt: now }),
  } as any;
}

// Save action to individual file
async function saveActionToFile(action: any): Promise<void> {
  if (!fs.existsSync(ACTIONS_DIR)) {
    fs.mkdirSync(ACTIONS_DIR, { recursive: true });
  }
  
  const filename = `${action.name.replace(/[^a-zA-Z0-9]/g, '_')}_${action.id}.json`;
  const filepath = path.join(ACTIONS_DIR, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(action, null, 2));
}

// Export action for sharing
export async function exportAction(id: string): Promise<string | null> {
  const action = await getActionById(id);
  return action ? JSON.stringify(action, null, 2) : null;
}

// Import action from JSON
export async function importAction(actionJson: string): Promise<Action> {
  const action = JSON.parse(actionJson);
  action.id = randomUUID(); // Generate new ID to avoid conflicts
  await saveActionToFile(action);
  return normalizeAction(action);
}

export async function getAllActions(): Promise<Action[]> {
  // Try individual files first, fall back to monolithic
  if (fs.existsSync(ACTIONS_DIR)) {
    const files = fs.readdirSync(ACTIONS_DIR);
    const actions: any[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json') && file !== '_metadata.json') {
        try {
          const content = fs.readFileSync(path.join(ACTIONS_DIR, file), 'utf8');
          const action = JSON.parse(content);
          actions.push(action);
        } catch (e) {
          console.warn(`Failed to load action file ${file}:`, e);
        }
      }
    }
    
    return actions.map(normalizeAction);
  }
  
  // Fallback to monolithic file
  const file = await readSbActionsFile();
  const actions = Array.isArray(file.actions) ? file.actions : [];
  return actions.map(normalizeAction);
}

export async function getActionById(id: string): Promise<Action | undefined> {
  const actions = await getAllActions();
  return actions.find((a) => a.id === id);
}

export type CreateActionInput = {
  name: string;
  group?: string;
  enabled?: boolean;
};

export async function createAction(input: CreateActionInput): Promise<Action> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const created: any = {
    id,
    name: input.name.trim() || 'Untitled Action',
    enabled: input.enabled ?? false,
    group: input.group?.trim() || undefined,
    alwaysRun: false,
    randomAction: false,
    concurrent: false,
    excludeFromHistory: false,
    excludeFromPending: false,
    triggers: [],
    subActions: [],
    createdAt: now,
    updatedAt: now,
  };
  
  await saveActionToFile(created);
  return normalizeAction(created);
}

export async function updateAction(id: string, updates: Partial<Action>): Promise<Action | null> {
  const current = await getActionById(id);
  if (!current) return null;
  
  const next = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  await saveActionToFile(next);
  return normalizeAction(next);
}

export async function deleteAction(id: string): Promise<boolean> {
  if (fs.existsSync(ACTIONS_DIR)) {
    const files = fs.readdirSync(ACTIONS_DIR);
    const file = files.find(f => f.includes(id) && f.endsWith('.json'));
    if (file) {
      fs.unlinkSync(path.join(ACTIONS_DIR, file));
      return true;
    }
    return false;
  }
  
  // Fallback to monolithic
  const file = await readSbActionsFile();
  const actions = Array.isArray(file.actions) ? (file.actions as any[]) : [];
  const next = actions.filter((a) => String(a?.id) !== id);
  if (next.length === actions.length) return false;
  await writeSbActionsFile({ ...file, actions: next });
  return true;
}

export function watchActionsFile(onChange: () => void): () => void {
  const throttleMs = 300;
  let timeout: NodeJS.Timeout | null = null;

  const watcher = fs.watch(SB_ACTIONS_FILE_PATH, () => {
    if (timeout) return;
    timeout = setTimeout(() => {
      timeout = null;
      onChange();
    }, throttleMs);
  });
  return () => watcher.close();
}
