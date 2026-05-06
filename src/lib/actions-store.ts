import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Action, SubAction, Trigger } from '@/services/automation/types';
import { readSbActionsFile, writeSbActionsFile } from '@/lib/sb-store';
import { SB_ACTIONS_FILE_PATH } from '@/lib/sb-store';
import { tenantPath } from '@/lib/tenant';

// Root actions directory (used as template for new tenants)
const ROOT_ACTIONS_DIR = path.join(process.cwd(), 'actions');

function getActionsDir(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'actions');
  return ROOT_ACTIONS_DIR;
}

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
async function saveActionToFile(action: any, tenantId?: string): Promise<void> {
  const dir = getActionsDir(tenantId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const filename = `${action.name.replace(/[^a-zA-Z0-9]/g, '_')}_${action.id}.json`;
  const filepath = path.join(dir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(action, null, 2));
}

// Export action for sharing
export async function exportAction(id: string, tenantId?: string): Promise<string | null> {
  const action = await getActionById(id, tenantId);
  return action ? JSON.stringify(action, null, 2) : null;
}

// Import action from JSON
export async function importAction(actionJson: string, tenantId?: string): Promise<Action> {
  const action = JSON.parse(actionJson);
  action.id = randomUUID();
  await saveActionToFile(action, tenantId);
  return normalizeAction(action);
}

export async function getAllActions(tenantId?: string): Promise<Action[]> {
  const dir = getActionsDir(tenantId);
  // Try individual files first, fall back to monolithic
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    const actions: any[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json') && file !== '_metadata.json') {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf8');
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

export async function getActionById(id: string, tenantId?: string): Promise<Action | undefined> {
  const actions = await getAllActions(tenantId);
  return actions.find((a) => a.id === id);
}

export type CreateActionInput = {
  name: string;
  group?: string;
  enabled?: boolean;
};

export async function createAction(input: CreateActionInput, tenantId?: string): Promise<Action> {
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
  
  await saveActionToFile(created, tenantId);
  return normalizeAction(created);
}

export async function updateAction(id: string, updates: Partial<Action>, tenantId?: string): Promise<Action | null> {
  const current = await getActionById(id, tenantId);
  if (!current) return null;
  
  const next = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  await saveActionToFile(next, tenantId);
  return normalizeAction(next);
}

export async function deleteAction(id: string, tenantId?: string): Promise<boolean> {
  const dir = getActionsDir(tenantId);
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
