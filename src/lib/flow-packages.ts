import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createAction, deleteAction, getAllActions } from '@/lib/actions-store';
import { createCommand, deleteCommand, getAllCommands } from '@/lib/commands-store';
import { globalPath } from '@/lib/tenant';

const FLOW_LIBRARY_DIR = globalPath('flow-library');
const FLOW_MANIFEST_DIR = globalPath('flow-library-manifests');

const packageCommandSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  command: z.string(),
  enabled: z.boolean().optional(),
  group: z.string().optional(),
}).passthrough();

const packageActionSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  enabled: z.boolean().optional(),
  group: z.string().optional(),
}).passthrough();

const flowPackageItemTagSchema = z.enum([
  'admin',
  'ai',
  'obs',
  'overlay',
  'economy',
  'pokemon',
  'discord',
  'voice',
  'social',
  'utility',
  'integration',
  'event',
]);

const flowPackageItemSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(['command', 'action']),
  label: z.string().min(1),
  group: z.string().default(''),
  required: z.boolean().default(false),
  enabledByDefault: z.boolean().default(true),
  role: z.enum(['primary', 'support', 'admin', 'variant', 'overlay']).default('support'),
  tags: z.array(flowPackageItemTagSchema).default([]),
  description: z.string().default(''),
  sourceId: z.string().optional(),
});

const flowPackageItemManifestSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  group: z.string().optional(),
  required: z.boolean().optional(),
  enabledByDefault: z.boolean().optional(),
  role: z.enum(['primary', 'support', 'admin', 'variant', 'overlay']).optional(),
  tags: z.array(flowPackageItemTagSchema).optional(),
  description: z.string().optional(),
});

export const flowPackageManifestSchema = z.object({
  packageId: z.string().min(1),
  name: z.string().min(1).optional(),
  collection: z.string().min(1).optional(),
  visibility: z.enum(['default', 'advanced', 'hidden']).optional(),
  notes: z.array(z.string()).optional(),
  items: z.object({
    commands: z.array(flowPackageItemManifestSchema).default([]),
    actions: z.array(flowPackageItemManifestSchema).default([]),
  }).default({ commands: [], actions: [] }),
});

export const flowPackageSelectionSchema = z.object({
  commandKeys: z.array(z.string()).default([]),
  actionKeys: z.array(z.string()).default([]),
}).passthrough();

export const flowPackageSchema = z.object({
  version: z.literal(1),
  kind: z.literal('streamweaver.flow-package'),
  packageId: z.string().min(1),
  name: z.string().min(1),
  packageKind: z.enum(['command_flow', 'action_flow', 'support_flow']),
  installUnit: z.literal('flow'),
  sourceModule: z.string().min(1),
  freezeTier: z.enum(['starter', 'built_in_module', 'official_library', 'internal_only', 'legacy_hold']),
  visibility: z.enum(['default', 'advanced', 'hidden']),
  collection: z.string().min(1),
  exportedAt: z.string().min(1),
  exportedByTenantId: z.string().optional(),
  commandFiles: z.array(z.string()).default([]),
  actionFiles: z.array(z.string()).default([]),
  commands: z.array(packageCommandSchema).default([]),
  actions: z.array(packageActionSchema).default([]),
  dependencies: z.array(z.string()).default([]),
  matchingNotes: z.array(z.object({
    action: z.string(),
    reason: z.string(),
  })).default([]),
  notes: z.array(z.string()).default([]),
  items: z.object({
    commands: z.array(flowPackageItemSchema).default([]),
    actions: z.array(flowPackageItemSchema).default([]),
  }).default({ commands: [], actions: [] }),
}).passthrough();

export type FlowPackage = z.infer<typeof flowPackageSchema>;
export type FlowPackageSelection = z.infer<typeof flowPackageSelectionSchema>;
export type FlowPackageItem = z.infer<typeof flowPackageItemSchema>;
export type FlowPackageManifest = z.infer<typeof flowPackageManifestSchema>;

export function isDefaultStarterFlowPackage(pkg: FlowPackage): boolean {
  return (
    pkg.visibility === 'default' &&
    (pkg.freezeTier === 'starter' || pkg.freezeTier === 'built_in_module') &&
    pkg.sourceModule !== 'deprecated-app-owned' &&
    pkg.sourceModule !== 'secret-legacy'
  );
}

export function getPackageCommandKey(command: Record<string, any>): string {
  return String(command.id || command.command || command.name || '').trim();
}

export function getPackageActionKey(action: Record<string, any>): string {
  return String(action.id || `${action.name || ''}:${action.group || ''}` || action.name || '').trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeCommandComparable(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^!+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function getTriggerCommandText(trigger: any): string {
  return String(
    trigger?.command ||
    trigger?.commandName ||
    trigger?.config?.command ||
    trigger?.pattern ||
    ''
  ).trim();
}

function getCommandFileNameLike(commandText: string): string {
  return `commands/${slugify(commandText || 'command')}.json`;
}

function buildCommandFromTrigger(trigger: any, action: InventoryEntry): Record<string, any> | null {
  const commandText = getTriggerCommandText(trigger);
  if (!commandText.startsWith('!')) return null;
  return {
    id: String(trigger?.commandId || `${action.id || action.name}-command`),
    name: commandText,
    command: commandText,
    enabled: action.enabled,
    group: action.group || 'Imported Flows',
    description: `Recovered from action trigger on ${action.name}`,
    sources: 1,
    caseSensitive: false,
    regex: false,
  };
}

function mergeManifestItems<T extends FlowPackageItem>(
  items: T[],
  edits: Array<z.infer<typeof flowPackageItemManifestSchema>>
): T[] {
  const byKey = new Map(edits.map((item) => [item.key, item]));
  return items.map((item) => {
    const edit = byKey.get(item.key);
    if (!edit) return item;
    return flowPackageItemSchema.parse({
      ...item,
      ...edit,
      tags: edit.tags ? uniqueStrings(edit.tags) : item.tags,
    }) as T;
  });
}

function applyFlowPackageManifest(pkg: FlowPackage, manifest?: FlowPackageManifest | null): FlowPackage {
  if (!manifest) return pkg;
  if (manifest.packageId !== pkg.packageId) return pkg;
  return flowPackageSchema.parse({
    ...pkg,
    name: manifest.name ?? pkg.name,
    collection: manifest.collection ?? pkg.collection,
    visibility: manifest.visibility ?? pkg.visibility,
    notes: manifest.notes ?? pkg.notes,
    items: {
      commands: mergeManifestItems(pkg.items.commands, manifest.items.commands),
      actions: mergeManifestItems(pkg.items.actions, manifest.items.actions),
    },
  });
}

function inferTagsFromText(text: string, moduleName?: string): FlowPackageItem['tags'] {
  const tags = new Set<FlowPackageItem['tags'][number]>();
  const combined = `${text} ${String(moduleName || '').toLowerCase()}`;

  if (/(^|\s)!(set|reset|add|give|steal|commands|stats|uptime)/.test(combined) || combined.includes('moderator') || combined.includes('broadcaster')) tags.add('admin');
  if (combined.includes('ai') || combined.includes('gpt') || combined.includes('athena') || combined.includes('{{bot_name}}') || combined.includes('tts')) tags.add('ai');
  if (combined.includes('obs') || combined.includes('scene') || combined.includes('source')) tags.add('obs');
  if (combined.includes('overlay') || combined.includes('showgroup') || combined.includes('showcategory') || combined.includes('cursor')) tags.add('overlay');
  if (combined.includes('point') || combined.includes('watchtime') || combined.includes('leaderboard') || combined.includes('gamble') || combined.includes('duel')) tags.add('economy');
  if (combined.includes('pokemon') || combined.includes('pokecard') || combined.includes('poketrade') || combined.includes('pack open')) tags.add('pokemon');
  if (combined.includes('discord')) tags.add('discord');
  if (combined.includes('voice') || combined.includes('tts') || combined.includes('audio')) tags.add('voice');
  if (combined.includes('hug') || combined.includes('boop') || combined.includes('cuddle') || combined.includes('social')) tags.add('social');
  if (combined.includes('follow') || combined.includes('time') || combined.includes('utility') || combined.includes('lurk') || combined.includes('shoutout')) tags.add('utility');
  if (combined.includes('kick') || combined.includes('discord') || combined.includes('tiktok') || combined.includes('bridge')) tags.add('integration');
  if (combined.includes('follow') || combined.includes('raid') || combined.includes('event') || combined.includes('welcome')) tags.add('event');

  return [...tags];
}

function collectReferencedActionIds(subActions: any[], into: Set<string>) {
  for (const subAction of subActions) {
    if (subAction?.actionId) into.add(String(subAction.actionId));
    if (Array.isArray(subAction?.subActions)) {
      collectReferencedActionIds(subAction.subActions, into);
    }
  }
}

export function getRequiredFlowPackageActionKeys(pkg: FlowPackage, selectedCommandKeys?: string[]): string[] {
  const selectedSet = selectedCommandKeys && selectedCommandKeys.length > 0
    ? new Set(selectedCommandKeys)
    : new Set(pkg.commands.map(getPackageCommandKey));
  const selectedCommands = pkg.commands.filter((command) => selectedSet.has(getPackageCommandKey(command)));
  const selectedCommandIds = new Set(selectedCommands.map((command) => String((command as any).id || '')).filter(Boolean));
  const selectedCommandTexts = new Set(selectedCommands.map((command) => String((command as any).command || '').trim().toLowerCase()).filter(Boolean));
  const selectedCommandComparables = new Set(
    selectedCommands
      .map((command) => normalizeCommandComparable((command as any).command || (command as any).name))
      .filter(Boolean)
  );
  const requiredActionIds = new Set<string>();

  for (const command of selectedCommands) {
    if ((command as any).actionId) requiredActionIds.add(String((command as any).actionId));
  }

  for (const action of pkg.actions) {
    if (action.id && selectedCommandComparables.has(normalizeCommandComparable(action.name))) {
      requiredActionIds.add(String(action.id));
    }

    const triggers = Array.isArray((action as any).triggers) ? (action as any).triggers : [];
    for (const trigger of triggers) {
      if (trigger?.commandId && selectedCommandIds.has(String(trigger.commandId)) && action.id) {
        requiredActionIds.add(String(action.id));
      }

      const triggerType = String(trigger?.type || '').toLowerCase();
      const triggerCommand = getTriggerCommandText(trigger).toLowerCase();
      if ((triggerType === 'chat command' || triggerType === 'command') && triggerCommand && selectedCommandTexts.has(triggerCommand) && action.id) {
        requiredActionIds.add(String(action.id));
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const action of pkg.actions) {
      if (action.id && requiredActionIds.has(String(action.id))) {
        const before = requiredActionIds.size;
        collectReferencedActionIds(Array.isArray((action as any).subActions) ? (action as any).subActions : [], requiredActionIds);
        if (requiredActionIds.size !== before) changed = true;
      }
    }
  }

  return pkg.actions
    .filter((action) => action.id && requiredActionIds.has(String(action.id)))
    .map(getPackageActionKey);
}

function buildCommandItemMetadata(command: Record<string, any>, moduleName: string): FlowPackageItem {
  const key = getPackageCommandKey(command);
  const commandText = String(command.command || command.name || '').trim();
  const tags = inferTagsFromText(`${commandText} ${String(command.group || '')}`.toLowerCase(), moduleName);
  const role: FlowPackageItem['role'] = tags.includes('admin') ? 'admin' : 'primary';

  return flowPackageItemSchema.parse({
    key,
    kind: 'command',
    label: commandText || 'Unnamed command',
    group: String(command.group || ''),
    required: true,
    enabledByDefault: true,
    role,
    tags,
    description: role === 'admin'
      ? 'Administrative command included with this flow.'
      : 'User-facing command included with this flow.',
    sourceId: command.id ? String(command.id) : undefined,
  });
}

function inferActionRole(action: Record<string, any>, required: boolean, tags: FlowPackageItem['tags']): FlowPackageItem['role'] {
  const text = `${String(action.name || '')} ${String(action.group || '')}`.toLowerCase();
  if (required && tags.includes('overlay')) return 'overlay';
  if (required) return 'support';
  if (tags.includes('admin')) return 'admin';
  if (tags.includes('overlay')) return 'overlay';
  if (text.includes('variant') || text.includes('v2') || text.includes('alternate')) return 'variant';
  return 'support';
}

function buildActionItemMetadata(action: Record<string, any>, moduleName: string, requiredActionKeys: Set<string>): FlowPackageItem {
  const key = getPackageActionKey(action);
  const subActions = Array.isArray(action.subActions) ? action.subActions : [];
  const triggers = Array.isArray(action.triggers) ? action.triggers : [];
  const triggerText = triggers.map((trigger) => `${String(trigger?.type || '')} ${String(trigger?.pattern || '')} ${String(trigger?.config?.command || '')}`).join(' ');
  const subActionText = subActions.map((subAction) => `${String(subAction?.type || '')} ${String(subAction?.code || '')} ${String(subAction?.language || '')} ${String(subAction?.provider || '')}`).join(' ');
  const tags = inferTagsFromText(`${String(action.name || '')} ${String(action.group || '')} ${triggerText} ${subActionText}`.toLowerCase(), moduleName);
  const required = requiredActionKeys.has(key);
  const role = inferActionRole(action, required, tags);

  return flowPackageItemSchema.parse({
    key,
    kind: 'action',
    label: String(action.name || 'Unnamed action'),
    group: String(action.group || ''),
    required,
    enabledByDefault: true,
    role,
    tags,
    description: required
      ? 'Required support action for the selected command flow.'
      : 'Optional helper, variant, or supporting action.',
    sourceId: action.id ? String(action.id) : undefined,
  });
}

function extractTriggeredCommandsForAction(action: InventoryEntry, commands: InventoryEntry[]): Array<Record<string, any>> {
  const rawAction = action.raw as Record<string, any>;
  const triggers = Array.isArray(rawAction.triggers) ? rawAction.triggers : [];
  const commandMap = new Map<string, Record<string, any>>();
  const commandsById = new Map(
    commands
      .filter((command) => command.id)
      .map((command) => [String(command.id), sanitizeCommandExport(command.raw)])
  );

  for (const trigger of triggers) {
    const triggerType = Number(trigger?.type);
    const triggerTypeText = String(trigger?.type || '').toLowerCase();
    const isCommandTrigger =
      triggerType === 401 ||
      triggerTypeText === 'chat command' ||
      triggerTypeText === 'command';
    if (!isCommandTrigger) continue;

    const triggerCommandId = String(trigger?.commandId || '').trim();
    if (triggerCommandId && commandsById.has(triggerCommandId)) {
      commandMap.set(triggerCommandId, commandsById.get(triggerCommandId) as Record<string, any>);
      continue;
    }

    const recovered = buildCommandFromTrigger(trigger, action);
    if (recovered) {
      commandMap.set(String(recovered.id), recovered);
    }
  }

  return [...commandMap.values()];
}

function hydrateFlowPackageMetadata(pkg: FlowPackage): FlowPackage {
  const parsed = flowPackageSchema.parse(pkg);
  const requiredActionKeys = new Set(getRequiredFlowPackageActionKeys(parsed));
  const existingCommandItems = new Map((parsed.items?.commands || []).map((item) => [item.key, flowPackageItemSchema.parse(item)]));
  const existingActionItems = new Map((parsed.items?.actions || []).map((item) => [item.key, flowPackageItemSchema.parse(item)]));
  const inferredCommandItems = parsed.commands.map((command) => buildCommandItemMetadata(command, parsed.sourceModule));
  const inferredActionItems = parsed.actions.map((action) => buildActionItemMetadata(action, parsed.sourceModule, requiredActionKeys));

  return flowPackageSchema.parse({
    ...parsed,
    items: {
      commands: inferredCommandItems.map((item) => existingCommandItems.get(item.key) || item),
      actions: inferredActionItems.map((item) => {
        const existing = existingActionItems.get(item.key);
        if (!existing) return item;
        return flowPackageItemSchema.parse({
          ...item,
          ...existing,
          required: item.required || existing.required,
          tags: uniqueStrings([...(item.tags || []), ...(existing.tags || [])]),
        });
      }),
    },
  });
}

function getFlowManifestPath(packageId: string): string {
  return path.join(FLOW_MANIFEST_DIR, `${packageId}.json`);
}

async function ensureFlowManifestDir() {
  await fsp.mkdir(FLOW_MANIFEST_DIR, { recursive: true });
}

export async function getFlowPackageManifest(packageId: string): Promise<FlowPackageManifest | null> {
  await ensureFlowManifestDir();
  try {
    const payload = JSON.parse(await fsp.readFile(getFlowManifestPath(packageId), 'utf8'));
    return flowPackageManifestSchema.parse(payload);
  } catch {
    return null;
  }
}

export async function saveFlowPackageManifest(manifest: FlowPackageManifest): Promise<FlowPackageManifest> {
  await ensureFlowManifestDir();
  const normalized = flowPackageManifestSchema.parse(manifest);
  await fsp.writeFile(getFlowManifestPath(normalized.packageId), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

export function buildFlowPackageManifestDraft(pkg: FlowPackage): FlowPackageManifest {
  const parsed = hydrateFlowPackageMetadata(pkg);
  return flowPackageManifestSchema.parse({
    packageId: parsed.packageId,
    name: parsed.name,
    collection: parsed.collection,
    visibility: parsed.visibility,
    notes: parsed.notes,
    items: {
      commands: parsed.items.commands.map((item) => ({
        key: item.key,
        label: item.label,
        group: item.group,
        required: item.required,
        enabledByDefault: item.enabledByDefault,
        role: item.role,
        tags: item.tags,
        description: item.description,
      })),
      actions: parsed.items.actions.map((item) => ({
        key: item.key,
        label: item.label,
        group: item.group,
        required: item.required,
        enabledByDefault: item.enabledByDefault,
        role: item.role,
        tags: item.tags,
        description: item.description,
      })),
    },
  });
}

export function selectFlowPackageEntries(pkg: FlowPackage, selection?: FlowPackageSelection): FlowPackage {
  const parsed = hydrateFlowPackageMetadata(pkg);
  if (!selection) return parsed;

  const requestedCommandKeys = new Set((selection.commandKeys || []).filter(Boolean));
  const requiredActionKeys = new Set(getRequiredFlowPackageActionKeys(parsed, [...requestedCommandKeys]));
  const requestedActionKeys = new Set([...(selection.actionKeys || []).filter(Boolean), ...requiredActionKeys]);

  const selectedCommands = parsed.commands.filter((command) => requestedCommandKeys.has(getPackageCommandKey(command)));
  const selectedActions = parsed.actions.filter((action) => requestedActionKeys.has(getPackageActionKey(action)));
  const selectedActionPaths = new Set(selectedActions.map((action) => action.name));

  return flowPackageSchema.parse({
    ...parsed,
    commands: selectedCommands,
    actions: selectedActions,
    commandFiles: parsed.commandFiles,
    actionFiles: parsed.actionFiles,
    matchingNotes: parsed.matchingNotes,
    items: {
      commands: parsed.items.commands.filter((item) => requestedCommandKeys.has(item.key)),
      actions: parsed.items.actions.filter((item) => requestedActionKeys.has(item.key)),
    },
  });
}

type ClassifiedModule =
  | 'ai-bot'
  | 'economy'
  | 'core-utility'
  | 'starter-social'
  | 'welcome'
  | 'pokemon'
  | 'redeem-pack'
  | 'checkins'
  | 'clips'
  | 'deathcounter'
  | 'menu-mode'
  | 'blerps'
  | 'music'
  | 'translation'
  | 'event-hooks'
  | 'kick'
  | 'discord'
  | 'tiktok'
  | 'chat-bridge'
  | 'game-pack'
  | 'deprecated-app-owned'
  | 'secret-legacy'
  | 'toolkits'
  | 'internal-support'
  | 'system'
  | 'links'
  | 'uncategorized';

type FreezeTier = FlowPackage['freezeTier'];

type InventoryEntry = {
  kind: 'command' | 'action';
  isCommand: boolean;
  id: string;
  name: string;
  file: string;
  path: string;
  group: string;
  enabled: boolean;
  command: string;
  actionId: string;
  handler: string;
  type: string;
  triggerCount: number;
  subActionCount: number;
  raw: Record<string, any>;
  module: ClassifiedModule;
  freezeTier: FreezeTier;
  visibility: FlowPackage['visibility'];
  notes: string[];
};

type FlowKey = string;

const OMIT_PACKAGE_ACTION_NAMES = new Set([
  'shop',
  'retro',
  'sticker',
  "vrflad's fasttrack set up - !setup",
]);

const OMIT_PACKAGE_COMMAND_NAMES = new Set([
  '!bitsleader',
  '!yup',
]);

function normalizeText(value: unknown): string {
  return String(value || '').toLowerCase();
}

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function slugify(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/^\!+/, '')
    .replace(/^\~+/, '')
    .replace(/\(\?i\)\.\*@\?/g, '')
    .replace(/\{\{bot_name\}\}/g, 'bot_name')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getCollection(moduleName: ClassifiedModule): string {
  const map: Record<ClassifiedModule, string> = {
    'ai-bot': 'AI',
    'economy': 'Economy',
    'core-utility': 'Core Utility',
    'starter-social': 'Social',
    'welcome': 'Welcome',
    'pokemon': 'Pokemon',
    'redeem-pack': 'Redeems',
    'checkins': 'Check-Ins',
    'clips': 'Clips',
    'deathcounter': 'Counters',
    'menu-mode': 'Overlays',
    'blerps': 'Audio',
    'music': 'Music',
    'translation': 'Utility',
    'event-hooks': 'Events',
    'kick': 'Integrations',
    'discord': 'Integrations',
    'tiktok': 'Integrations',
    'chat-bridge': 'Integrations',
    'game-pack': 'Games',
    'deprecated-app-owned': 'Deprecated',
    'secret-legacy': 'Hidden',
    'toolkits': 'Advanced',
    'internal-support': 'Internal',
    'system': 'System',
    'links': 'Links',
    'uncategorized': 'Misc',
  };
  return map[moduleName];
}

function getExplicitFlowKeys(entry: Pick<InventoryEntry, 'isCommand' | 'module' | 'name' | 'group' | 'command' | 'file'>): FlowKey[] {
  const name = normalizeText(entry.name);
  const group = normalizeText(entry.group);
  const command = normalizeText(entry.command);
  const file = normalizeText(entry.file);
  const text = `${name} ${group} ${command} ${file}`;
  const keys = new Set<FlowKey>();

  const add = (...values: FlowKey[]) => values.filter(Boolean).forEach((value) => keys.add(value));

  if (entry.module === 'ai-bot') {
    if (text.includes('{{bot_name}}') || text.includes('chatgpt') || text.includes('athena') || text.includes('chat call')) {
      add('ai.bot-call');
    }
  }

  if (entry.module === 'economy') {
    if (command === '!points') add('economy.points');
    if (command === '!addpoints') add('economy.add-points');
    if (command === '!addtoall') add('economy.add-to-all');
    if (command === '!setpoints') add('economy.set-points');
    if (command === '!settoall') add('economy.set-to-all');
    if (command === '!resetallpoints') add('economy.reset-all-points');
    if (command === '!givepoints') add('economy.give-points');
    if (command === '!stealpoints') add('economy.steal-points');
    if (command === '!watchtime') add('economy.watchtime');
    if (command === '!wleader') add('economy.watchtime-leaderboard');
    if (command === '!pleader') add('economy.points', 'economy.points-leaderboard');
    if (command === '!bleader') add('economy.badge-leaderboard');
    if (command === '!cleader') add('economy.card-leaderboard');
    if (command === '!bitsleader') add('economy.bits-leaderboard');
    if (command === '!leader') add('economy.leaderboard');
    if (command === '!gamble') add('economy.gamble');
    if (command === '!coinflip') add('economy.gamble', 'economy.coinflip');
    if (command === '!roll') add('economy.gamble', 'economy.roll');
    if (command === '!duel') add('economy.duel');
    if (command === '!shop') add('economy.shop');

    if (!entry.isCommand) {
      if (name.includes('currency system • events')) add(
        'economy.points',
        'economy.add-points',
        'economy.add-to-all',
        'economy.set-points',
        'economy.set-to-all',
        'economy.reset-all-points',
        'economy.give-points',
        'economy.steal-points'
      );
      if (name.includes('currency system • commands')) add(
        'economy.points',
        'economy.add-points',
        'economy.add-to-all',
        'economy.set-points',
        'economy.set-to-all',
        'economy.reset-all-points'
      );
      if (name.includes('currency system • settings')) add(
        'economy.points',
        'economy.add-points',
        'economy.add-to-all',
        'economy.set-points',
        'economy.set-to-all',
        'economy.reset-all-points',
        'economy.give-points',
        'economy.steal-points'
      );
      if (name.includes('give points')) add('economy.give-points', 'economy.steal-points');
      if (name.includes('get watchtime user')) add('economy.watchtime');
      if (name.includes('auto add watchtime')) add('economy.watchtime', 'economy.watchtime-leaderboard');
      if (name.includes('leaderboard')) add('economy.leaderboard', 'economy.points-leaderboard', 'economy.badge-leaderboard', 'economy.card-leaderboard', 'economy.bits-leaderboard');
      if (name.includes('updateleaderboard')) add('economy.leaderboard', 'economy.points-leaderboard', 'economy.badge-leaderboard', 'economy.card-leaderboard', 'economy.bits-leaderboard');
      if (name.includes('top doner')) add('economy.leaderboard');
      if (name.includes('[ccg] - classic chat gamble')) add('economy.gamble', 'economy.coinflip');
      if (name.includes('[ccg] - cooldown message')) add('economy.gamble', 'economy.coinflip', 'economy.duel', 'economy.roll', 'economy.shop');
      if (name === 'duel') add('economy.duel', 'economy.gamble');
      if (name === 'shop') add('economy.shop');
      if (name === '!roll') add('economy.gamble', 'economy.roll');
    }
  }

  if (entry.module === 'welcome') {
    if (command === '!welcomemode') add('welcome.mode');

    if (!entry.isCommand) {
      if (name === 'welcome' || name.includes('welcome new followers') || name.includes('walk-on') || name.includes('walk-onlog') || name.includes('gptwalkon')) {
        add('welcome.mode');
      }
    }
  }

  if (!entry.isCommand) {
    if (name === 'welcome' || name.includes('welcome new followers') || name.includes('walk-on') || name.includes('walk on') || name.includes('gptwalkon')) {
      add('welcome.mode');
    }
  }

  if (entry.module === 'core-utility') {
    if (command === '!brb') add('utility.brb');
    if (command === '!so') add('utility.shoutout');
    if (command === '!time') add('utility.time');
    if (command === '!lurk') add('utility.lurk');
    if (command === '!unlurk') add('utility.unlurk');
    if (command === '!accept' || command === '!yes' || command === '!no') add('utility.multi-step');
    if (command === '!followage') add('utility.followage');
    if (command === '!followed') add('utility.followed');
    if (command === '!followers') add('utility.followers');
    if (command === '!raidmessage') add('utility.raidmessage');

    if (!entry.isCommand) {
      if (name === '!brb video player') add('utility.brb');
      if (name === 'shoutout command' || name === '!so - custom shout out' || name === '!setso - set custom shout out' || name === '!vso - video shout out v2') {
        add('utility.shoutout');
      }
      if (name === '!date' || name === '!time') add('utility.time');
      if (name === '!created') add('utility.created');
      if (name === '!emergency' || name === '!emergencyover') add('utility.emergency');
      if (name === 'visuallurk') add('utility.lurk');
      if (name === '!unlurk') add('utility.unlurk');
      if (name === '!accept' || name === '!yes' || name === '!no') add('utility.multi-step');
      if (name === '!followage') add('utility.followage');
      if (name === '!followed') add('utility.followed');
      if (name === '!followers') add('utility.followers');
      if (name === '!raidmessage') add('utility.raidmessage');
    }
  }

  if (entry.module === 'links') {
    if (command === '!tiktok') add('socials.platforms');

    if (!entry.isCommand) {
      if (name === '!tiktok') add('socials.platforms');
    }
  }

  if (entry.module === 'event-hooks') {
    if (name.includes('new follower') || name.includes('super follow')) add('events.follow');
    if (name.includes('new subscriber')) add('events.subscribe');
    if (name.includes('resub')) add('events.resub');
    if (name.includes('gift sub')) add('events.gift-sub');
    if (name.includes('gift bomb')) add('events.gift-bomb');
    if (name === 'raid') add('events.raid');
    if (name === 'cheer') add('events.cheer');
  }

  if (entry.module === 'clips') {
    if (command === '!clip') add('clips.create');
    if (!entry.isCommand) add('clips.create');
  }

  if (entry.module === 'deathcounter' && !entry.isCommand) {
    add('deathcounter.core');
  }

  if (entry.module === 'menu-mode' && !entry.isCommand) {
    add('menu.mode');
  }

  if (entry.module === 'music') {
    if (command === '!sr') add('music.song-request');
    if (!entry.isCommand) add('music.song-request');
  }

  if (entry.module === 'translation') {
    if (command === '!t') add('translation.chat');
    if (!entry.isCommand && name === 'translation') add('translation.chat');
  }

  if (entry.module === 'pokemon') {
    if (command === 'pack') add('pokemon.pack-open');
    if (command === '!show') add('pokemon.show-card');
    if (!entry.isCommand && name === 'pokecard') add('pokemon.show-card');
    if (!entry.isCommand && (name.includes('pack') || file.includes('pack'))) add('pokemon.pack-open');
  }

  if (!entry.isCommand) {
    if (name === 'kick events' || name === 'tiktok events' || name === 'kickbot' || name === 'twitch' || name === 'tiktok') {
      add('socials.platforms');
    }
    if (name === 'random video from folder (dynamic delay)' || name === 'random video from folder (set delay)') {
      add('toolkits.random-video-folder');
    }
    if (name === 'athena voice bic' || name === 'bic lighter tracker') {
      add('starter-social.bic');
    }
    if (name === 'wotd') {
      add('game-pack.wotd');
    }
  }

  return [...keys];
}

function getPrimaryFlowKey(entry: Pick<InventoryEntry, 'isCommand' | 'module' | 'name' | 'group' | 'command' | 'file' | 'id'>): FlowKey {
  const explicit = getExplicitFlowKeys(entry);
  if (explicit.length > 0) return explicit[0];
  return `${entry.module}.${slugify(entry.command || entry.name || entry.file || entry.id) || entry.id}`;
}

function getRelatedFlowKeys(flowKey: FlowKey): FlowKey[] {
  const related = new Set<FlowKey>();

  const add = (...values: FlowKey[]) => values.filter(Boolean).forEach((value) => related.add(value));

  switch (flowKey) {
    case 'economy.points':
      add('economy.points-leaderboard');
      break;
    case 'economy.add-points':
    case 'economy.add-to-all':
    case 'economy.set-points':
    case 'economy.set-to-all':
    case 'economy.reset-all-points':
    case 'economy.give-points':
    case 'economy.steal-points':
      add(
        'economy.points',
        'economy.add-points',
        'economy.add-to-all',
        'economy.set-points',
        'economy.set-to-all',
        'economy.reset-all-points',
        'economy.give-points',
        'economy.steal-points'
      );
      break;
    case 'economy.watchtime-leaderboard':
      add('economy.watchtime', 'economy.leaderboard');
      break;
    case 'economy.points-leaderboard':
    case 'economy.badge-leaderboard':
    case 'economy.card-leaderboard':
    case 'economy.bits-leaderboard':
      add('economy.leaderboard');
      break;
    case 'economy.gamble':
      add('economy.coinflip', 'economy.roll', 'economy.duel');
      break;
    case 'economy.coinflip':
      add('economy.gamble', 'economy.roll', 'economy.duel');
      break;
    default:
      break;
  }

  return [...related];
}

function classifyModule(entry: Omit<InventoryEntry, 'module' | 'freezeTier' | 'visibility' | 'notes'>): ClassifiedModule {
  const text = [
    entry.file,
    entry.name,
    entry.group,
    entry.command,
    entry.handler,
    entry.type,
  ].map(normalizeText).join(' ');

  if (hasAny(text, ['tag game', 'tag-pass', 'check-tag', 'tagpasses', 'tag-command', '!tag', '!tagpasses'])) return 'deprecated-app-owned';
  if (hasAny(text, ['channel point style redeems', 'channel point redeems', 'channel points cost'])) return 'redeem-pack';
  if (hasAny(text, ['chatrd'])) return 'chat-bridge';
  if (hasAny(text, ['links'])) return 'links';
  if (hasAny(text, ['fun commands'])) return 'starter-social';
  if (hasAny(text, ['secret commands'])) return 'secret-legacy';
  if (hasAny(text, ['champion of the hill', 'special actions'])) return 'game-pack';
  if (hasAny(text, ['pokemon', 'pokecard', 'poketrade', 'pokepack', 'pokedex'])) return 'pokemon';
  if (hasAny(text, ['partner check', 'crewcheckin', 'crew checkin', 'modcheckin', 'mod checkin', 'spmt', 'space mountain', 'partnermessage'])) return 'checkins';
  if (hasAny(text, ['menumode', 'menu mode', 'cursor', 'showgroup', 'showcategory', 'showhelpoverlay', 'showinvalidgroupoverlay', 'hidemenuoverlay'])) return 'menu-mode';
  if (hasAny(text, ['deathcounter'])) return 'deathcounter';
  if (hasAny(text, ['blerp'])) return 'blerps';
  if (hasAny(text, ['clip'])) return 'clips';
  if (normalizeText(entry.command) === '!t' || hasAny(text, [' translation '])) return 'translation';
  if (normalizeText(entry.command) === '!show' || normalizeText(entry.name) === '!show') return 'pokemon';
  if (['!accept', '!yes', '!no'].includes(normalizeText(entry.command))) return 'core-utility';
  if (normalizeText(entry.command) === '!roll') return 'economy';
  if (hasAny(text, ['chatgpt', 'athena', 'aibot', 'voice reply', 'whisper', 'chat call', 'commander'])) return 'ai-bot';
  if (hasAny(text, ['currency', 'points', 'gamble', 'coinflip', 'duel', 'watchtime', 'leaderboard', 'leader', 'wleader', 'pleader', 'bleader', 'cleader', 'bitsleader', 'shop', 'givepoints', 'addpoints', 'setpoints'])) return 'economy';
  if (hasAny(text, ['!lurk', '!unlurk', 'visuallurk'])) return 'core-utility';
  if (hasAny(text, ['welcome new followers', 'welcomemode', 'welcome wagon', 'walk-on', 'walk on', 'gptwalkon', 'lurk', 'unlurk'])) return 'welcome';
  if (hasAny(text, ['!boop', '!hug', '!headpat', '!fistbump', '!cuddle', '!dance', '!tickle', '!love', '!roll', '!show', '!no', '!yes', '!yup', '!bic', '!highfive'])) return 'starter-social';
  if (hasAny(text, ['mod commands', 'chat commands', '!so', 'shoutout', '!settitle', '!setgame', '!followage', '!followed', '!followers', '!stats', '!uptime', '!time', '!commands', '!created', '!raidmessage', '!brb', '!accept'])) return 'core-utility';
  if (hasAny(text, ['events', 'follow', 'subscriber', 'resub', 'gift sub', 'gift bomb', 'raid', 'cheer'])) return 'event-hooks';
  if (hasAny(text, ['kick'])) return 'kick';
  if (hasAny(text, ['tiktok'])) return 'tiktok';
  if (hasAny(text, ['discord'])) return 'discord';
  if (hasAny(text, ['song request', 'hearmeout', '!sr'])) return 'music';
  if (hasAny(text, ['translation'])) return 'translation';
  if (hasAny(text, ['toolkit', 'toolbelt', 'fasttrack', 'random video'])) return 'toolkits';
  if (hasAny(text, ['error -', 'unable to afford', 'fail'])) return 'internal-support';
  if (hasAny(text, ['system', 'welcome wagon toggle'])) return 'system';
  return 'uncategorized';
}

function classifyTier(base: Omit<InventoryEntry, 'freezeTier' | 'visibility' | 'notes'>): FreezeTier {
  const text = [base.file, base.name, base.group, base.command, base.handler, base.type].map(normalizeText).join(' ');
  const isCopy = hasAny(text, ['copy', '__copy__']);
  const isInternalSupport =
    base.module === 'internal-support' ||
    hasAny(text, ['cursor', 'showgroup', 'showcategory', 'showinvalidgroupoverlay', 'hidemenuoverlay', 'chatdispatcher', 'update checker']) ||
    (!base.isCommand && base.triggerCount === 0 && base.subActionCount === 0 && !base.handler && !base.type);

  if (base.module === 'deprecated-app-owned') return 'legacy_hold';
  if (base.module === 'secret-legacy') return 'legacy_hold';
  if (isCopy || isInternalSupport) return 'internal_only';
  if (base.module === 'pokemon') return 'built_in_module';
  if (['checkins', 'menu-mode', 'deathcounter', 'blerps', 'clips', 'music', 'translation', 'toolkits', 'kick', 'tiktok', 'discord', 'links', 'redeem-pack', 'event-hooks', 'game-pack', 'chat-bridge'].includes(base.module)) {
    return 'official_library';
  }
  if (['ai-bot', 'economy', 'welcome', 'starter-social', 'core-utility', 'system'].includes(base.module)) {
    return 'starter';
  }
  return 'legacy_hold';
}

function buildNotes(base: Omit<InventoryEntry, 'notes'>): string[] {
  const notes: string[] = [];
  if (base.module === 'deprecated-app-owned') notes.push('Deprecated app-owned feature; kept only for migration compatibility.');
  if (base.freezeTier === 'built_in_module') notes.push('Built-in module because it remains interconnected and widely used.');
  if (base.freezeTier === 'official_library') notes.push('Optional or setup-heavy feature intended for library/community browsing.');
  if (base.freezeTier === 'starter') notes.push('Part of the default starter experience.');
  if (base.freezeTier === 'internal_only') notes.push('Internal support or duplicate implementation detail.');
  return notes;
}

function toInventoryEntry(kind: 'command' | 'action', filePath: string, raw: Record<string, any>): InventoryEntry {
  const base: Omit<InventoryEntry, 'module' | 'freezeTier' | 'visibility' | 'notes'> = {
    kind,
    isCommand: kind === 'command',
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    file: path.basename(filePath),
    path: filePath,
    group: String(raw.group || ''),
    enabled: raw.enabled !== false,
    command: String(raw.command || ''),
    actionId: String(raw.actionId || ''),
    handler: String(raw.handler || ''),
    type: String(raw.type || ''),
    triggerCount: Array.isArray(raw.triggers) ? raw.triggers.length : 0,
    subActionCount: Array.isArray(raw.subActions) ? raw.subActions.length : 0,
    raw,
  };

  const moduleName = classifyModule(base);
  const entryWithoutNotes = {
    ...base,
    module: moduleName,
    freezeTier: 'legacy_hold' as FreezeTier,
    visibility: 'hidden' as FlowPackage['visibility'],
  };
  const freezeTier = classifyTier(entryWithoutNotes);
  const visibility: FlowPackage['visibility'] =
    freezeTier === 'internal_only' || freezeTier === 'legacy_hold'
      ? 'hidden'
      : freezeTier === 'official_library'
        ? 'advanced'
        : 'default';

  return {
    ...base,
    module: moduleName,
    freezeTier,
    visibility,
    notes: buildNotes({ ...base, module: moduleName, freezeTier, visibility }),
  };
}

function buildActionIndexes(actions: InventoryEntry[]) {
  const byId = new Map<string, InventoryEntry>();
  const bySlug = new Map<string, InventoryEntry[]>();
  const byFlowKey = new Map<FlowKey, InventoryEntry[]>();

  for (const action of actions) {
    if (action.id) byId.set(action.id, action);
    const slugs = new Set([
      slugify(action.name),
      slugify(action.file),
      slugify(action.path),
    ]);
    for (const slug of slugs) {
      if (!slug) continue;
      const existing = bySlug.get(slug) || [];
      existing.push(action);
      bySlug.set(slug, existing);
    }

    for (const flowKey of getExplicitFlowKeys(action)) {
      const existing = byFlowKey.get(flowKey) || [];
      existing.push(action);
      byFlowKey.set(flowKey, existing);
    }
  }

  return { byId, bySlug, byFlowKey };
}

function getActionMatchesForCommand(command: InventoryEntry, actionIndexes: ReturnType<typeof buildActionIndexes>) {
  const matches: Array<{ action: InventoryEntry; reason: string }> = [];
  const seen = new Set<string>();
  const add = (action: InventoryEntry | undefined, reason: string) => {
    if (!action || seen.has(action.path)) return;
    seen.add(action.path);
    matches.push({ action, reason });
  };

  if (command.actionId && actionIndexes.byId.has(command.actionId)) {
    add(actionIndexes.byId.get(command.actionId), 'direct-actionId');
  }

  const slugs = [
    slugify(command.command || command.name || command.file),
    slugify(command.name),
    slugify(command.file),
  ];

  for (const slug of slugs) {
    for (const action of actionIndexes.bySlug.get(slug) || []) {
      add(action, 'slug-match');
    }
  }

  const commandFlowKeys = getExplicitFlowKeys(command);

  for (const flowKey of commandFlowKeys) {
    for (const action of actionIndexes.byFlowKey.get(flowKey) || []) {
      add(action, `flow-key:${flowKey}`);
    }
  }

  for (const flowKey of commandFlowKeys) {
    for (const relatedFlowKey of getRelatedFlowKeys(flowKey)) {
      for (const action of actionIndexes.byFlowKey.get(relatedFlowKey) || []) {
        add(action, `related-flow-key:${flowKey}->${relatedFlowKey}`);
      }
    }
  }

  const allActions = [...actionIndexes.byId.values()];
  const commandSlug = slugify(command.command || command.name || command.id);
  const lowerName = normalizeText(command.name);
  const lowerCommand = normalizeText(command.command);

  const addFiltered = (predicate: (action: InventoryEntry) => boolean, reason: string) => {
    for (const action of allActions) {
      if (predicate(action)) add(action, reason);
    }
  };

  if (command.module === 'ai-bot') {
    addFiltered(
      (action) => action.module === 'ai-bot' && action.freezeTier !== 'internal_only' && !normalizeText(action.name).includes('copy'),
      'ai-module-cluster'
    );
  }

  if (command.module === 'economy') {
    if (hasAny(commandSlug, ['watchtime', 'wleader'])) {
      addFiltered(
        (action) => action.module === 'economy' && hasAny(`${normalizeText(action.name)} ${normalizeText(action.group)}`, ['watchtime']),
        'economy-watchtime-cluster'
      );
    }

    if (hasAny(commandSlug, ['leader', 'pleader', 'bleader', 'cleader', 'bitsleader'])) {
      addFiltered(
        (action) => action.module === 'economy' && hasAny(`${normalizeText(action.name)} ${normalizeText(action.group)}`, ['leaderboard', 'leader', 'top doner']),
        'economy-leader-cluster'
      );
    }

    if (hasAny(commandSlug, ['points', 'addpoints', 'addtoall', 'setpoints', 'settoall', 'resetallpoints', 'givepoints', 'stealpoints'])) {
      addFiltered(
        (action) => action.module === 'economy' && hasAny(`${normalizeText(action.name)} ${normalizeText(action.group)}`, ['currency system • commands', 'currency system • settings', 'currency system • events', 'currency system • fail', 'streamup currency', 'give points']),
        'economy-currency-cluster'
      );
    }
  }

  if (command.module === 'welcome') {
    if (!Array.isArray((command.raw as Record<string, any>).actions) || (command.raw as Record<string, any>).actions.length === 0) {
      addFiltered(
        (action) => {
          if (action.module !== 'welcome') return false;
          const actionText = `${normalizeText(action.name)} ${normalizeText(action.file)} ${normalizeText(action.group)}`;
          if (commandSlug === 'welcomemode') return hasAny(actionText, ['welcome', 'walk-on', 'walk on', 'gptwalkon']);
          if (commandSlug === 'lurk') return hasAny(actionText, ['visuallurk', '!lurk']) && !actionText.includes('unlurk');
          if (commandSlug === 'unlurk') return hasAny(actionText, ['unlurk']);
          return normalizeText(action.name) === commandSlug || normalizeText(action.file).includes(commandSlug);
        },
        'welcome-cluster'
      );
    }
  }

  if (command.module === 'starter-social' || command.module === 'core-utility') {
    addFiltered(
      (action) => {
        const actionText = `${normalizeText(action.name)} ${normalizeText(action.file)}`;
        if (commandSlug === 'lurk' && actionText.includes('unlurk')) return false;
        return action.module === command.module && commandSlug.length >= 4 && actionText.includes(commandSlug);
      },
      'module-fuzzy-match'
    );
  }

  if (command.module === 'clips') {
    addFiltered(
      (action) => action.module === 'clips',
      'clips-cluster'
    );
  }

  if (command.module === 'music') {
    addFiltered(
      (action) => action.module === 'music',
      'music-cluster'
    );
  }

  if (command.module === 'pokemon') {
    addFiltered(
      (action) => action.module === 'pokemon' && (normalizeText(action.name).includes(commandSlug) || normalizeText(action.file).includes(commandSlug)),
      'pokemon-cluster'
    );
  }

  return matches.filter((item) => item.action.freezeTier !== 'internal_only');
}

function shouldPackageCommand(entry: InventoryEntry): boolean {
  if (OMIT_PACKAGE_COMMAND_NAMES.has(normalizeText(entry.command))) return false;
  return entry.freezeTier !== 'internal_only';
}

function shouldPackageStandaloneAction(entry: InventoryEntry): boolean {
  if (entry.freezeTier === 'internal_only') return false;
  if (OMIT_PACKAGE_ACTION_NAMES.has(normalizeText(entry.name))) return false;
  if (entry.module === 'deprecated-app-owned') return true;
  if (entry.module === 'internal-support') return false;
  if (entry.module === 'menu-mode' && entry.triggerCount === 0) return false;
  if (entry.triggerCount === 0 && !entry.handler && !entry.type) return false;
  return true;
}

function sanitizeCommandExport(raw: Record<string, any>): Record<string, any> {
  const next = { ...raw };
  delete next.createdAt;
  delete next.updatedAt;
  return next;
}

function sanitizeActionExport(raw: Record<string, any>): Record<string, any> {
  const next = { ...raw };
  delete next.createdAt;
  delete next.updatedAt;
  return next;
}

async function buildInventory(tenantId?: string) {
  const [commandsRaw, actionsRaw] = await Promise.all([
    getAllCommands(tenantId),
    getAllActions(tenantId),
  ]);

  const commands = commandsRaw.map((raw) => {
    const file = `${slugify((raw as any).command || (raw as any).name || (raw as any).id)}-${(raw as any).id || randomUUID()}.json`;
    return toInventoryEntry('command', `commands/${file}`, raw as Record<string, any>);
  });

  const actions = actionsRaw.map((raw) => {
    const file = `${slugify((raw as any).name || (raw as any).id)}-${(raw as any).id || randomUUID()}.json`;
    return toInventoryEntry('action', `actions/${file}`, raw as Record<string, any>);
  });

  return { commands, actions };
}

export async function listTenantFlowPackages(tenantId?: string): Promise<FlowPackage[]> {
  const { commands, actions } = await buildInventory(tenantId);
  const actionIndexes = buildActionIndexes(actions);
  const claimedActions = new Set<string>();
  const packageMap = new Map<string, FlowPackage>();

  const upsertPackage = (pkg: FlowPackage) => {
    const existing = packageMap.get(pkg.packageId);
    if (!existing) {
      packageMap.set(pkg.packageId, pkg);
      return;
    }

    const mergeUnique = (left: string[], right: string[]) => [...new Set([...left, ...right])];
    existing.commandFiles = mergeUnique(existing.commandFiles, pkg.commandFiles);
    existing.actionFiles = mergeUnique(existing.actionFiles, pkg.actionFiles);
    existing.dependencies = mergeUnique(existing.dependencies, pkg.dependencies);
    existing.notes = mergeUnique(existing.notes, pkg.notes);
    existing.commands = [...existing.commands, ...pkg.commands].filter(
      (item, index, arr) => arr.findIndex((other) => (other.id || `${other.command}:${other.name}`) === (item.id || `${item.command}:${item.name}`)) === index
    );
    existing.actions = [...existing.actions, ...pkg.actions].filter(
      (item, index, arr) => arr.findIndex((other) => (other.id || `${other.name}:${other.group || ''}`) === (item.id || `${item.name}:${item.group || ''}`)) === index
    );
    existing.matchingNotes = [...existing.matchingNotes, ...pkg.matchingNotes].filter(
      (item, index, arr) => arr.findIndex((other) => other.action === item.action && other.reason === item.reason) === index
    );
    existing.items = {
      commands: [...existing.items.commands, ...pkg.items.commands].filter(
        (item, index, arr) => arr.findIndex((other) => other.key === item.key) === index
      ),
      actions: [...existing.items.actions, ...pkg.items.actions].filter(
        (item, index, arr) => arr.findIndex((other) => other.key === item.key) === index
      ),
    };
  };

  for (const command of commands) {
    if (!shouldPackageCommand(command)) continue;
    const matches = getActionMatchesForCommand(command, actionIndexes);
    for (const match of matches) claimedActions.add(match.action.path);

    upsertPackage(hydrateFlowPackageMetadata(flowPackageSchema.parse({
      version: 1,
      kind: 'streamweaver.flow-package',
      packageId: `flow.${getPrimaryFlowKey(command).replace(/[^a-z0-9._-]+/gi, '-')}`,
      name: command.command || command.name,
      packageKind: 'command_flow',
      installUnit: 'flow',
      sourceModule: command.module,
      freezeTier: command.freezeTier,
      visibility: command.visibility,
      collection: getCollection(command.module),
      exportedAt: new Date().toISOString(),
      exportedByTenantId: tenantId,
      commandFiles: [command.path],
      actionFiles: matches.map((item) => item.action.path),
      commands: [sanitizeCommandExport(command.raw)],
      actions: matches.map((item) => sanitizeActionExport(item.action.raw)),
      dependencies: [],
      matchingNotes: matches.map((item) => ({ action: item.action.path, reason: item.reason })),
      notes: command.notes,
    })));
  }

  for (const action of actions) {
    if (claimedActions.has(action.path)) continue;
    if (!shouldPackageStandaloneAction(action)) continue;

    const actionCommands = extractTriggeredCommandsForAction(action, commands);
    const actionCommandFiles = actionCommands.map((command) =>
      String(command?.path || getCommandFileNameLike(String(command.command || command.name || 'command')))
    );
    const packageKind: FlowPackage['packageKind'] = actionCommands.length > 0 ? 'command_flow' : 'action_flow';

    upsertPackage(hydrateFlowPackageMetadata(flowPackageSchema.parse({
      version: 1,
      kind: 'streamweaver.flow-package',
      packageId: `flow.${getPrimaryFlowKey(action).replace(/[^a-z0-9._-]+/gi, '-')}`,
      name: action.name,
      packageKind,
      installUnit: 'flow',
      sourceModule: action.module,
      freezeTier: action.freezeTier,
      visibility: action.visibility,
      collection: getCollection(action.module),
      exportedAt: new Date().toISOString(),
      exportedByTenantId: tenantId,
      commandFiles: actionCommandFiles,
      actionFiles: [action.path],
      commands: actionCommands,
      actions: [sanitizeActionExport(action.raw)],
      dependencies: [],
      matchingNotes: [],
      notes: action.notes,
    })));
  }

  const manifestEntries = await Promise.all(
    [...packageMap.values()].map(async (pkg) => applyFlowPackageManifest(pkg, await getFlowPackageManifest(pkg.packageId)))
  );

  return manifestEntries.sort((a, b) => a.packageId.localeCompare(b.packageId));
}

export async function getTenantFlowPackage(packageId: string, tenantId?: string): Promise<FlowPackage | null> {
  const packages = await listTenantFlowPackages(tenantId);
  return packages.find((item) => item.packageId === packageId) || null;
}

async function ensureFlowLibraryDir() {
  await fsp.mkdir(FLOW_LIBRARY_DIR, { recursive: true });
}

function getPublishedPackagePath(packageId: string): string {
  return path.join(FLOW_LIBRARY_DIR, `${packageId}.json`);
}

export async function listPublishedFlowPackages(): Promise<FlowPackage[]> {
  await ensureFlowLibraryDir();
  const files = (await fsp.readdir(FLOW_LIBRARY_DIR)).filter((file) => file.endsWith('.json')).sort((a, b) => a.localeCompare(b));
  const packages: FlowPackage[] = [];

  for (const file of files) {
    try {
      const payload = JSON.parse(await fsp.readFile(path.join(FLOW_LIBRARY_DIR, file), 'utf8'));
      const hydrated = hydrateFlowPackageMetadata(flowPackageSchema.parse(payload));
      packages.push(applyFlowPackageManifest(hydrated, await getFlowPackageManifest(hydrated.packageId)));
    } catch (error) {
      console.warn(`[FlowPackages] Failed to load published package ${file}:`, error);
    }
  }

  return packages;
}

export async function publishFlowPackage(packageData: FlowPackage): Promise<FlowPackage> {
  await ensureFlowLibraryDir();
  const normalized = hydrateFlowPackageMetadata(flowPackageSchema.parse(packageData));
  await fsp.writeFile(getPublishedPackagePath(normalized.packageId), JSON.stringify(normalized, null, 2), 'utf8');
  return applyFlowPackageManifest(normalized, await getFlowPackageManifest(normalized.packageId));
}

export async function deletePublishedFlowPackage(packageId: string): Promise<boolean> {
  await ensureFlowLibraryDir();
  const target = getPublishedPackagePath(packageId);
  try {
    await fsp.unlink(target);
    return true;
  } catch {
    return false;
  }
}

export async function publishTenantFlowPackage(packageId: string, tenantId?: string): Promise<FlowPackage> {
  const pkg = await getTenantFlowPackage(packageId, tenantId);
  if (!pkg) throw new Error('Flow package not found');
  return publishFlowPackage(pkg);
}

export async function deleteTenantFlowPackage(packageId: string, tenantId?: string): Promise<{ commands: number; actions: number }> {
  const pkg = await getTenantFlowPackage(packageId, tenantId);
  if (!pkg) throw new Error('Flow package not found');

  let commands = 0;
  let actions = 0;
  for (const command of pkg.commands) {
    if (command.id && await deleteCommand(String(command.id), tenantId)) commands += 1;
  }
  for (const action of pkg.actions) {
    if (action.id && await deleteAction(String(action.id), tenantId)) actions += 1;
  }
  return { commands, actions };
}

export async function importFlowPackage(pkg: FlowPackage, tenantId?: string): Promise<{ commands: number; actions: number; skippedCommands: number; skippedActions: number }> {
  const parsed = hydrateFlowPackageMetadata(flowPackageSchema.parse(pkg));
  let importedCommands = 0;
  let importedActions = 0;
  let skippedCommands = 0;
  let skippedActions = 0;

  const commandIdMap = new Map<string, string>();
  const actionIdMap = new Map<string, string>();
  const existingCommands = await getAllCommands(tenantId);
  const existingActions = await getAllActions(tenantId);
  const existingCommandBySourceId = new Map(existingCommands.map((command: any) => [`${String(command.sourcePackageId || '')}:${String(command.sourceOriginalId || '')}`, command]));
  const existingCommandByText = new Map(existingCommands.map((command: any) => [String(command.command || '').trim().toLowerCase(), command]));
  const existingActionBySourceId = new Map(existingActions.map((action: any) => [`${String((action as any).sourcePackageId || '')}:${String((action as any).sourceOriginalId || '')}`, action]));
  const existingActionByNameGroup = new Map(existingActions.map((action: any) => [`${String(action.name || '').trim().toLowerCase()}:${String(action.group || '').trim().toLowerCase()}`, action]));

  for (const rawCommand of parsed.commands) {
    if (!rawCommand.id) continue;
    const sourceKey = `${parsed.packageId}:${String(rawCommand.id)}`;
    const existing = existingCommandBySourceId.get(sourceKey);
    commandIdMap.set(String(rawCommand.id), existing?.id ? String(existing.id) : randomUUID());
  }

  for (const rawAction of parsed.actions) {
    if (!rawAction.id) continue;
    const sourceKey = `${parsed.packageId}:${String(rawAction.id)}`;
    const existing = existingActionBySourceId.get(sourceKey);
    actionIdMap.set(String(rawAction.id), existing?.id ? String(existing.id) : randomUUID());
  }

  const remapSubActions = (subActions: any[]): any[] =>
    subActions.map((subAction) => ({
      ...subAction,
      actionId: subAction?.actionId ? actionIdMap.get(String(subAction.actionId)) || subAction.actionId : subAction?.actionId,
      subActions: Array.isArray(subAction?.subActions) ? remapSubActions(subAction.subActions) : subAction?.subActions,
    }));

  for (const rawCommand of parsed.commands) {
    const commandText = String(rawCommand.command || '').trim();
    if (!commandText) continue;
    const sourceKey = rawCommand.id ? `${parsed.packageId}:${String(rawCommand.id)}` : '';
    const existing = (sourceKey ? existingCommandBySourceId.get(sourceKey) : undefined) || existingCommandByText.get(commandText.toLowerCase());
    if (existing?.id) {
      if (rawCommand.id) commandIdMap.set(String(rawCommand.id), String(existing.id));
      skippedCommands += 1;
      continue;
    }
    await createCommand({
      ...(rawCommand as Record<string, any>),
      id: rawCommand.id ? commandIdMap.get(String(rawCommand.id)) : undefined,
      name: String(rawCommand.name || commandText),
      command: commandText,
      actionId: (rawCommand as any).actionId ? actionIdMap.get(String((rawCommand as any).actionId)) || (rawCommand as any).actionId : undefined,
      group: rawCommand.group,
      enabled: rawCommand.enabled ?? true,
      sourcePackageId: parsed.packageId,
      sourceOriginalId: rawCommand.id ? String(rawCommand.id) : undefined,
    }, tenantId);
    importedCommands += 1;
  }

  for (const rawAction of parsed.actions) {
    const actionName = String(rawAction.name || '').trim();
    if (!actionName) continue;
    const sourceKey = rawAction.id ? `${parsed.packageId}:${String(rawAction.id)}` : '';
    const nameGroupKey = `${actionName.toLowerCase()}:${String(rawAction.group || '').trim().toLowerCase()}`;
    const existing = (sourceKey ? existingActionBySourceId.get(sourceKey) : undefined) || existingActionByNameGroup.get(nameGroupKey);
    if (existing?.id) {
      if (rawAction.id) actionIdMap.set(String(rawAction.id), String(existing.id));
      skippedActions += 1;
      continue;
    }
    await createAction({
      ...(rawAction as Record<string, any>),
      id: rawAction.id ? actionIdMap.get(String(rawAction.id)) : undefined,
      name: actionName,
      triggers: Array.isArray((rawAction as any).triggers)
        ? (rawAction as any).triggers.map((trigger: any) => ({
            ...trigger,
            commandId: trigger?.commandId ? commandIdMap.get(String(trigger.commandId)) || trigger.commandId : trigger?.commandId,
          }))
        : (rawAction as any).triggers,
      subActions: Array.isArray((rawAction as any).subActions)
        ? remapSubActions((rawAction as any).subActions)
        : (rawAction as any).subActions,
      group: rawAction.group,
      enabled: rawAction.enabled ?? false,
      sourcePackageId: parsed.packageId,
      sourceOriginalId: rawAction.id ? String(rawAction.id) : undefined,
    }, tenantId);
    importedActions += 1;
  }

  return { commands: importedCommands, actions: importedActions, skippedCommands, skippedActions };
}

export function parseFlowPackage(input: unknown): FlowPackage {
  return hydrateFlowPackageMetadata(flowPackageSchema.parse(input));
}

export function getFlowLibraryDir(): string {
  return FLOW_LIBRARY_DIR;
}
