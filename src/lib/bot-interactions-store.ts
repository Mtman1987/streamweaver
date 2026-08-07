import { promises as fs } from 'fs';
import { resolve } from 'path';
import { globalPath, tenantPath } from '@/lib/tenant';
import { readWorldLore, type WorldLoreCharacter } from '@/lib/world-lore-store';
import { isBotTriggerIgnored } from '@/lib/bot-trigger-ignore-store';

export type BotShareMode = 'off' | 'on';
export type BotInteractionKind = 'interaction' | 'shared-memory' | 'backstage-lore';
export type BotInteractionPlatform = 'twitch' | 'discord' | 'kick' | 'youtube' | 'app' | 'social-stream';
export type BotInteractionOrigin = 'live-chat' | 'interest-ingestion' | 'idle-scene' | 'explicit-relay' | 'manual';

export type BotInteractionEntry = {
  id: string;
  timestamp: string;
  platform: BotInteractionPlatform;
  tenantId?: string;
  sourceTenantId?: string;
  sourceEventId?: string;
  channelId?: string;
  sourceUser: string;
  speakerBotId: string;
  speakerBotName: string;
  targetBotIds: string[];
  targetBotNames: string[];
  triggerMessage: string;
  responseMessage: string;
  kind?: BotInteractionKind;
  origin?: BotInteractionOrigin;
  interestTags?: string[];
  delivered?: boolean;
  expiresAt?: string;
};

export type BotInteractionDecision = {
  shouldRespond: boolean;
  reason: string;
  speaker: WorldLoreCharacter;
  targets: WorldLoreCharacter[];
  promptInstruction: string;
};

type MentionedCharacter = {
  character: WorldLoreCharacter;
  index: number;
  trigger: string;
};

function modeFilePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/bot-share-mode.json');
  return globalPath('bot-share-mode.json');
}

function historyFilePath(tenantId: string): string {
  if (!tenantId) throw new Error('Bot interaction history requires a tenant ID');
  return tenantPath(tenantId, 'data/bot-interactions.json');
}

const historyWriteLocks = new Map<string, Promise<void>>();

function isExpired(entry: Pick<BotInteractionEntry, 'expiresAt'>): boolean {
  if (!entry.expiresAt) return false;
  const expiresAt = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

async function readHistoryFile(filePath: string): Promise<BotInteractionEntry[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry === 'object' && !isExpired(entry))
      : [];
  } catch {
    return [];
  }
}

async function writeHistoryFile(filePath: string, entries: BotInteractionEntry[]): Promise<void> {
  await fs.mkdir(resolve(filePath, '..'), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(entries, null, 2));
  await fs.rename(temporaryPath, filePath);
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function triggerMatches(messageLower: string, trigger: string): boolean {
  const normalized = normalize(trigger).replace(/^@/, '');
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])@?${escaped}([^a-z0-9_]|$)`, 'i').test(messageLower);
}

function triggerIndex(messageLower: string, trigger: string): number {
  const normalized = normalize(trigger).replace(/^@/, '');
  if (!normalized) return -1;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[^a-z0-9_])@?${escaped}([^a-z0-9_]|$)`, 'i').exec(messageLower);
  return match?.index ?? -1;
}

function characterTriggers(character: WorldLoreCharacter): string[] {
  return Array.from(new Set([
    character.currentName,
    ...(character.aliases || []),
    ...(character.previousNames || []),
  ].filter(Boolean)));
}

export async function getBotShareMode(tenantId?: string): Promise<BotShareMode> {
  try {
    const raw = await fs.readFile(modeFilePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.mode === 'on' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

export async function setBotShareMode(mode: BotShareMode, tenantId?: string): Promise<BotShareMode> {
  const filePath = modeFilePath(tenantId);
  await fs.mkdir(resolve(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ mode }, null, 2));
  return mode;
}

export async function toggleBotShareMode(tenantId?: string): Promise<BotShareMode> {
  const current = await getBotShareMode(tenantId);
  return setBotShareMode(current === 'on' ? 'off' : 'on', tenantId);
}

/**
 * This setting controls spontaneous visible bot-to-bot chat only. Backstage
 * lore and explicit human-requested relays do not use this gate.
 */
export async function isBotSharePairEnabled(sourceTenantId?: string, targetTenantId?: string): Promise<boolean> {
  if (!sourceTenantId || !targetTenantId) return false;
  if (await getBotShareMode(sourceTenantId) !== 'on') return false;
  if (sourceTenantId === targetTenantId) return true;
  return await getBotShareMode(targetTenantId) === 'on';
}

export async function readBotInteractionHistory(limit = 10, tenantId: string): Promise<BotInteractionEntry[]> {
  const tenantHistory = await readHistoryFile(historyFilePath(tenantId));
  if (tenantHistory.length) return tenantHistory.slice(-Math.max(1, limit));

  // Grandfather only entries explicitly owned by this tenant from the former
  // global history file. Entries without ownership cannot be copied safely.
  const legacyHistory = await readHistoryFile(globalPath('bot-interactions.json'));
  return legacyHistory
    .filter((entry) => entry.tenantId === tenantId)
    .slice(-Math.max(1, limit));
}

export async function appendBotInteraction(entry: Omit<BotInteractionEntry, 'id' | 'timestamp'> & {
  tenantId: string;
  id?: string;
  timestamp?: string;
}): Promise<void> {
  const filePath = historyFilePath(entry.tenantId);
  const previousWrite = historyWriteLocks.get(entry.tenantId) || Promise.resolve();
  const nextWrite = previousWrite.then(async () => {
    const existing = await readBotInteractionHistory(300, entry.tenantId);
    const next: BotInteractionEntry = {
      ...entry,
      id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      targetBotIds: Array.from(new Set(entry.targetBotIds || [])),
      targetBotNames: Array.from(new Set(entry.targetBotNames || [])),
      interestTags: Array.from(new Set((entry.interestTags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))),
    };
    const sameSource = (candidate: BotInteractionEntry) => Boolean(
      next.sourceEventId
      && candidate.sourceEventId === next.sourceEventId
      && candidate.kind === next.kind
      && candidate.speakerBotId === next.speakerBotId
      && candidate.targetBotIds.slice().sort().join(',') === next.targetBotIds.slice().sort().join(',')
    );
    await writeHistoryFile(filePath, [...existing.filter((candidate) => candidate.id !== next.id && !sameSource(candidate)), next].slice(-300));
  });
  historyWriteLocks.set(entry.tenantId, nextWrite);
  try {
    await nextWrite;
  } finally {
    if (historyWriteLocks.get(entry.tenantId) === nextWrite) historyWriteLocks.delete(entry.tenantId);
  }
}

export async function appendBackstageLoreMemory(input: {
  sourceTenantId: string;
  targetTenantId: string;
  platform: BotInteractionPlatform;
  channelId?: string;
  sourceUser: string;
  speaker: WorldLoreCharacter;
  target: WorldLoreCharacter;
  triggerMessage: string;
  memoryText: string;
  sourceEventId?: string;
  interestTags?: string[];
  origin?: BotInteractionOrigin;
  delivered?: boolean;
  expiresAt?: string;
  kind?: Extract<BotInteractionKind, 'shared-memory' | 'backstage-lore'>;
}): Promise<void> {
  const sourceTenantId = String(input.sourceTenantId || '').trim();
  const targetTenantId = String(input.targetTenantId || '').trim();
  const memoryText = String(input.memoryText || '').replace(/\s+/g, ' ').trim().slice(0, 12_000);
  if (!sourceTenantId || !targetTenantId || !memoryText) {
    throw new Error('Backstage bot lore requires source tenant, target tenant, and memory text.');
  }

  const sharedEntry = {
    platform: input.platform,
    sourceTenantId,
    sourceEventId: input.sourceEventId,
    channelId: input.channelId,
    sourceUser: input.sourceUser,
    speakerBotId: input.speaker.stableId,
    speakerBotName: input.speaker.currentName,
    targetBotIds: [input.target.stableId],
    targetBotNames: [input.target.currentName],
    triggerMessage: input.triggerMessage,
    responseMessage: memoryText,
    kind: input.kind || 'backstage-lore' as const,
    origin: input.origin || 'manual' as const,
    interestTags: input.interestTags || [],
    delivered: input.delivered === true,
    expiresAt: input.expiresAt,
  };

  const participantTenants = Array.from(new Set([sourceTenantId, targetTenantId]));
  await Promise.all(participantTenants.map((tenantId) => appendBotInteraction({
    ...sharedEntry,
    tenantId,
  })));
}

/** Compatibility name retained for callers created during the AthenaOS draft. */
export async function appendSharedBotMemory(input: Parameters<typeof appendBackstageLoreMemory>[0]): Promise<void> {
  return appendBackstageLoreMemory({ ...input, kind: input.kind || 'shared-memory' });
}

export async function formatBotInteractionHistoryForPrompt(limit = 8, tenantId: string): Promise<string> {
  const history = await readBotInteractionHistory(limit, tenantId);
  if (!history.length) return '';
  const lines = history.map((entry) => {
    const targets = entry.targetBotNames.length ? entry.targetBotNames.join(', ') : 'the bot group';
    const tags = entry.interestTags?.length ? ` Interests: ${entry.interestTags.join(', ')}.` : '';
    if (entry.kind === 'backstage-lore' || entry.kind === 'shared-memory') {
      const delivery = entry.delivered
        ? 'It was also delivered through a real platform relay.'
        : 'It happened backstage and was not posted as live bot chatter.';
      return `Backstage bot memory: ${entry.speakerBotName} shared with ${targets}: "${entry.responseMessage}". ${delivery}${tags}`;
    }
    const targetSuffix = entry.targetBotNames.length ? ` to ${entry.targetBotNames.join(', ')}` : '';
    return `${entry.speakerBotName}${targetSuffix}: ${entry.responseMessage}`;
  });
  return `Recent cross-bot history and living backstage lore:\n${lines.join('\n')}`;
}

export async function decideBotInteraction(input: {
  message: string;
  currentBotName: string;
  tenantId?: string;
  platform: 'twitch' | 'discord';
  mode?: BotShareMode;
  additionalMentions?: Array<{
    character: WorldLoreCharacter;
    trigger: string;
  }>;
  allowedSpeakerStableIds?: string[];
  allowedTargetStableIds?: string[];
}): Promise<BotInteractionDecision | null> {
  // !botshare gates only visible spontaneous replies and name-trigger chains.
  const mode = input.mode || await getBotShareMode(input.tenantId);
  if (mode !== 'on') return null;

  const lore = await readWorldLore();
  const characters = Object.values(lore?.characters || {});
  if (!characters.length) return null;

  const messageLower = input.message.toLowerCase();
  const mentioned = findMentionedCharacters(messageLower, characters);
  for (const extra of input.additionalMentions || []) {
    const index = triggerIndex(messageLower, extra.trigger);
    if (index < 0) continue;
    const existing = mentioned.find((entry) => entry.character.stableId === extra.character.stableId);
    if (existing) {
      if (index < existing.index || (index === existing.index && extra.trigger.length > existing.trigger.length)) {
        existing.index = index;
        existing.trigger = extra.trigger;
      }
      continue;
    }
    mentioned.push({
      character: extra.character,
      index,
      trigger: extra.trigger,
    });
  }
  mentioned.sort((a, b) => a.index - b.index || b.trigger.length - a.trigger.length);

  const currentBotLower = normalize(input.currentBotName);
  const currentBotMention = mentioned.find((entry) =>
    characterTriggers(entry.character).some((trigger) => normalize(trigger) === currentBotLower)
  );
  const speaker = mentioned[0]?.character || currentBotMention?.character;
  if (!speaker) return null;
  if (input.allowedSpeakerStableIds?.length && !input.allowedSpeakerStableIds.includes(speaker.stableId)) {
    return null;
  }
  if (await isBotTriggerIgnored({
    tenantId: input.tenantId,
    stableId: speaker.stableId,
    botName: speaker.currentName,
  }, input.tenantId)) return null;
  if (currentBotMention && speaker.stableId !== currentBotMention.character.stableId) return null;

  const explicitTargets = mentioned
    .map((entry) => entry.character)
    .filter((character) => character.stableId !== speaker.stableId);
  const inferredTargets = input.platform === 'discord'
    ? inferRelationshipTargets({
        messageLower,
        speaker,
        characters,
        relationships: lore?.relationships || {},
      })
    : [];
  const targets = uniqueCharacters([...explicitTargets, ...inferredTargets])
    .filter((character) => character.stableId !== speaker.stableId);
  if (!targets.length) return null;
  const allowedTargets: WorldLoreCharacter[] = [];
  for (const target of targets) {
    if (input.allowedTargetStableIds?.length && !input.allowedTargetStableIds.includes(target.stableId)) {
      continue;
    }
    if (!(await isBotTriggerIgnored({
      tenantId: input.tenantId,
      stableId: target.stableId,
      botName: target.currentName,
    }, input.tenantId))) {
      allowedTargets.push(target);
    }
  }
  if (!allowedTargets.length) return null;

  const recent = input.tenantId ? await formatBotInteractionHistoryForPrompt(6, input.tenantId) : '';
  const targetNames = allowedTargets.map((target) => target.currentName).join(', ');
  const promptInstruction = [
    `Visible cross-bot interaction request on ${input.platform}.`,
    `You are ${speaker.currentName}. Reply directly to or about ${targetNames}.`,
    'Keep it to 1-2 short sentences. Do not impersonate the other bot. Do not continue the conversation unless a human asks.',
    recent,
    `Human trigger: ${input.message}`,
  ].filter(Boolean).join('\n');

  return {
    shouldRespond: true,
    reason: inferredTargets.length > 0 ? 'relationship-cross-bot-mention' : 'explicit-cross-bot-mention',
    speaker,
    targets: allowedTargets,
    promptInstruction,
  };
}

export function firstMentionedCharacter(message: string, characters: WorldLoreCharacter[]): WorldLoreCharacter | null {
  return findMentionedCharacters(message.toLowerCase(), characters)[0]?.character || null;
}

export { historyFilePath as getBotInteractionHistoryFilePath };

function findMentionedCharacters(messageLower: string, characters: WorldLoreCharacter[]): MentionedCharacter[] {
  const matches: MentionedCharacter[] = [];
  for (const character of characters) {
    let best: MentionedCharacter | null = null;
    for (const trigger of characterTriggers(character)) {
      const index = triggerIndex(messageLower, trigger);
      if (index < 0) continue;
      if (!best || index < best.index || (index === best.index && trigger.length > best.trigger.length)) {
        best = { character, index, trigger };
      }
    }
    if (best) matches.push(best);
  }
  return matches.sort((a, b) => a.index - b.index || b.trigger.length - a.trigger.length);
}

function uniqueCharacters(characters: WorldLoreCharacter[]): WorldLoreCharacter[] {
  const seen = new Set<string>();
  const unique: WorldLoreCharacter[] = [];
  for (const character of characters) {
    if (seen.has(character.stableId)) continue;
    seen.add(character.stableId);
    unique.push(character);
  }
  return unique;
}

function inferRelationshipTargets(input: {
  messageLower: string;
  speaker: WorldLoreCharacter;
  characters: WorldLoreCharacter[];
  relationships: Record<string, { characterIds: string[]; label: string; summary: string }>;
}): WorldLoreCharacter[] {
  const relationshipIds = input.speaker.relationshipIds || [];
  if (!relationshipIds.length) return [];

  const targets: WorldLoreCharacter[] = [];
  for (const relationshipId of relationshipIds) {
    const relationship = input.relationships[relationshipId];
    if (!relationship || !relationship.characterIds.includes(input.speaker.stableId)) continue;
    if (!relationshipPhraseMatches(input.messageLower, relationship.label, relationship.summary)) continue;

    for (const characterId of relationship.characterIds) {
      if (characterId === input.speaker.stableId) continue;
      const target = input.characters.find((character) => character.stableId === characterId);
      if (target) targets.push(target);
    }
  }

  return targets;
}

function relationshipPhraseMatches(messageLower: string, label: string, summary: string): boolean {
  const relationshipText = `${label} ${summary}`.toLowerCase();
  const phraseGroups = [
    ['sister', 'sisters', 'sibling', 'siblings'],
    ['brother', 'brothers', 'sibling', 'siblings'],
    ['rival', 'rivals'],
    ['teacher', 'professor', 'dad'],
    ['best friend', 'best friends', 'friend', 'friends'],
    ['soft spot', 'favorite'],
    ['opposite', 'opposites'],
  ];

  return phraseGroups.some((phrases) =>
    phrases.some((phrase) => relationshipText.includes(phrase))
    && phrases.some((phrase) => messageLower.includes(phrase))
  );
}

export { triggerMatches };
