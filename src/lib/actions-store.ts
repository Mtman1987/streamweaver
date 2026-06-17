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

function loadActionsFromDir(dir: string): any[] {
  if (!fs.existsSync(dir)) return [];

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

  return actions;
}

function mergeActions(base: any[], overrides: any[]): any[] {
  const merged = new Map<string, any>();

  for (const action of base) {
    const key = String(action?.id || action?.name || '').trim().toLowerCase();
    if (!key) continue;
    merged.set(key, action);
  }

  for (const action of overrides) {
    const key = String(action?.id || action?.name || '').trim().toLowerCase();
    if (!key) continue;
    merged.set(key, action);
  }

  return Array.from(merged.values());
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

  if (action?.id) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json') || file === '_metadata.json') continue;
      const candidate = path.join(dir, file);
      if (candidate !== filepath && file.includes(String(action.id))) {
        fs.unlinkSync(candidate);
      }
    }
  }
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
  // Prefer shared root action files, then overlay any tenant-specific overrides.
  if (tenantId) {
    const rootActions = loadActionsFromDir(ROOT_ACTIONS_DIR);
    const tenantActions = loadActionsFromDir(getActionsDir(tenantId));
    const merged = mergeActions(rootActions, tenantActions);
    if (merged.length > 0) {
      return merged.map(normalizeAction);
    }
  } else {
    const rootActions = loadActionsFromDir(ROOT_ACTIONS_DIR);
    if (rootActions.length > 0) {
      return rootActions.map(normalizeAction);
    }
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
} & Partial<Action> & Record<string, any>;

export async function createAction(input: CreateActionInput, tenantId?: string): Promise<Action> {
  const now = new Date().toISOString();
  const id = String((input as any).id || randomUUID());
  const created: any = {
    ...input,
    id,
    name: input.name.trim() || 'Untitled Action',
    enabled: input.enabled ?? false,
    group: input.group?.trim() || undefined,
    alwaysRun: input.alwaysRun ?? false,
    randomAction: input.randomAction ?? false,
    concurrent: input.concurrent ?? false,
    excludeFromHistory: input.excludeFromHistory ?? false,
    excludeFromPending: input.excludeFromPending ?? false,
    queue: input.queue,
    triggers: Array.isArray(input.triggers) ? input.triggers : [],
    subActions: Array.isArray(input.subActions) ? input.subActions : [],
    createdAt: now,
    updatedAt: now,
  };
  
  await saveActionToFile(created, tenantId);
  return normalizeAction(created);
}

export async function duplicateAction(id: string, tenantId?: string): Promise<Action | null> {
  const current = await getActionById(id, tenantId);
  if (!current) return null;

  return createAction({
    ...current,
    id: undefined,
    name: `${current.name} Copy`,
    enabled: false,
  } as any, tenantId);
}

export async function replaceActions(actions: any[], tenantId?: string): Promise<number> {
  const dir = getActionsDir(tenantId);
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
  for (const raw of actions) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String((raw as any).id || randomUUID());
    const next = normalizeAction({
      ...(raw as any),
      id,
      createdAt: (raw as any).createdAt ?? now,
      updatedAt: (raw as any).updatedAt ?? now,
    });
    await saveActionToFile(next, tenantId);
    count += 1;
  }
  return count;
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
