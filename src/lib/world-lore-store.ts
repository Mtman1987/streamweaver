import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';
import { globalPath } from './tenant';

export type WorldLoreCharacter = {
  stableId: string;
  currentName: string;
  aliases?: string[];
  previousNames?: string[];
  archetype?: string;
  domainId?: string;
  summary?: string;
  personalityNotes?: string[];
  relationshipIds?: string[];
};

export type WorldLore = {
  schemaVersion: number;
  worldId: string;
  title: string;
  subtitle?: string;
  tagline?: string;
  identityRules?: {
    stableIdPattern?: string;
    note?: string;
  };
  overview?: string[];
  toneRules?: string[];
  domains?: Record<string, {
    name: string;
    role?: string;
    atmosphere?: string;
    associatedCharacterIds?: string[];
  }>;
  characters?: Record<string, WorldLoreCharacter>;
  relationships?: Record<string, {
    characterIds: string[];
    label: string;
    summary: string;
  }>;
  crossBotEvents?: Record<string, {
    name: string;
    associatedCharacterIds?: string[];
    signals?: string[];
    usage?: string;
  }>;
};

export type WorldLoreJournalOrigin = 'interest-ingestion' | 'idle-scene' | 'explicit-relay' | 'manual';

export type WorldLoreJournalEntry = {
  id: string;
  timestamp: string;
  summary: string;
  origin: WorldLoreJournalOrigin;
  sourceTenantId?: string;
  sourceEventId?: string;
  participantTenantIds: string[];
  participantCharacterIds: string[];
  participantBotNames: string[];
  interestTags: string[];
  expiresAt?: string;
};

export type WorldLorePromptOptions = {
  tenantId?: string;
  botName?: string;
  interestTags?: string[];
  journalLimit?: number;
};

function getWorldLoreFilePath(): string {
  return globalPath('world-lore.json');
}

function getDefaultWorldLoreFilePath(): string {
  return resolve(process.cwd(), 'src', 'data', 'world-lore-default.json');
}

function getWorldLoreJournalFilePath(): string {
  return globalPath('world-lore-journal.json');
}

function cleanList(values: unknown[]): string[] {
  return Array.from(new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function normalizeTag(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isExpired(entry: Pick<WorldLoreJournalEntry, 'expiresAt'>, now = Date.now()): boolean {
  if (!entry.expiresAt) return false;
  const expiresAt = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

async function readJournalFile(): Promise<WorldLoreJournalEntry[]> {
  try {
    const raw = await fs.readFile(getWorldLoreJournalFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is WorldLoreJournalEntry => Boolean(
      entry
      && typeof entry === 'object'
      && typeof entry.id === 'string'
      && typeof entry.summary === 'string'
      && Array.isArray(entry.participantTenantIds)
      && Array.isArray(entry.participantCharacterIds)
      && Array.isArray(entry.participantBotNames)
      && Array.isArray(entry.interestTags)
    ));
  } catch {
    return [];
  }
}

let journalWriteLock: Promise<void> = Promise.resolve();

async function writeJournalFile(entries: WorldLoreJournalEntry[]): Promise<void> {
  const filePath = getWorldLoreJournalFilePath();
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(entries, null, 2), 'utf-8');
  await fs.rename(temporaryPath, filePath);
}

export async function readWorldLore(): Promise<WorldLore | null> {
  for (const filePath of [getWorldLoreFilePath(), getDefaultWorldLoreFilePath()]) {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.worldId !== 'string') {
        continue;
      }
      return parsed as WorldLore;
    } catch {
      // Try the next source.
    }
  }
  return null;
}

export async function readWorldLoreJournal(limit = 500): Promise<WorldLoreJournalEntry[]> {
  const entries = await readJournalFile();
  return entries
    .filter((entry) => !isExpired(entry))
    .slice(-Math.max(1, limit));
}

export async function appendWorldLoreJournalEntry(
  input: Omit<WorldLoreJournalEntry, 'id' | 'timestamp'> & Partial<Pick<WorldLoreJournalEntry, 'id' | 'timestamp'>>,
  options: { maxEntries?: number } = {},
): Promise<WorldLoreJournalEntry> {
  const summary = String(input.summary || '').replace(/\s+/g, ' ').trim().slice(0, 12_000);
  if (!summary) throw new Error('Living world lore requires a summary.');

  const participantTenantIds = cleanList(input.participantTenantIds || []);
  const participantCharacterIds = cleanList(input.participantCharacterIds || []);
  const participantBotNames = cleanList(input.participantBotNames || []);
  const interestTags = cleanList(input.interestTags || []).map(normalizeTag).filter(Boolean);
  if (!participantTenantIds.length && !participantCharacterIds.length && !participantBotNames.length) {
    throw new Error('Living world lore requires at least one participant.');
  }

  const fingerprint = [
    input.origin,
    input.sourceEventId || '',
    ...participantTenantIds,
    ...participantCharacterIds,
    summary.toLowerCase(),
  ].join('|');
  const entry: WorldLoreJournalEntry = {
    id: input.id || `lore_${createHash('sha256').update(fingerprint).digest('hex').slice(0, 20)}`,
    timestamp: input.timestamp || new Date().toISOString(),
    summary,
    origin: input.origin,
    sourceTenantId: input.sourceTenantId,
    sourceEventId: input.sourceEventId,
    participantTenantIds,
    participantCharacterIds,
    participantBotNames,
    interestTags,
    expiresAt: input.expiresAt,
  };

  const maxEntries = Math.max(20, options.maxEntries ?? 500);
  const previousWrite = journalWriteLock;
  let release!: () => void;
  journalWriteLock = new Promise<void>((resolveLock) => { release = resolveLock; });
  await previousWrite;
  try {
    const existing = (await readJournalFile()).filter((candidate) => !isExpired(candidate));
    const dedupeKey = (candidate: WorldLoreJournalEntry) => [
      candidate.sourceEventId || candidate.id,
      candidate.origin,
      candidate.participantTenantIds.slice().sort().join(','),
      candidate.summary.toLowerCase(),
    ].join('|');
    const entryKey = dedupeKey(entry);
    const next = [...existing.filter((candidate) => candidate.id !== entry.id && dedupeKey(candidate) !== entryKey), entry]
      .slice(-maxEntries);
    await writeJournalFile(next);
  } finally {
    release();
  }

  return entry;
}

function journalRelevant(entry: WorldLoreJournalEntry, options: WorldLorePromptOptions): boolean {
  if (!options.tenantId && !options.botName && !options.interestTags?.length) return true;
  if (options.tenantId && entry.participantTenantIds.includes(options.tenantId)) return true;
  const botName = normalizeTag(options.botName);
  if (botName && entry.participantBotNames.some((name) => normalizeTag(name) === botName)) return true;
  const interests = new Set((options.interestTags || []).map(normalizeTag).filter(Boolean));
  return entry.interestTags.some((tag) => interests.has(normalizeTag(tag)));
}

export async function formatWorldLoreForPrompt(options: WorldLorePromptOptions = {}): Promise<string> {
  const [lore, journal] = await Promise.all([
    readWorldLore(),
    readWorldLoreJournal(Math.max(20, options.journalLimit || 100)),
  ]);
  if (!lore) return '';

  const lines: string[] = [
    `Shared world lore: ${lore.title}${lore.subtitle ? ` - ${lore.subtitle}` : ''}.`,
  ];

  if (lore.identityRules?.note) {
    lines.push(`Identity rule: ${lore.identityRules.note}`);
  }

  if (lore.overview?.length) {
    lines.push(`World overview: ${lore.overview.join(' ')}`);
  }

  if (lore.toneRules?.length) {
    lines.push(`Lore usage rules: ${lore.toneRules.join(' ')}`);
  }

  const characters = Object.values(lore.characters || {});
  if (characters.length) {
    lines.push('Known bot spirits:');
    for (const character of characters) {
      const aliases = character.aliases?.filter((alias) => alias !== character.currentName);
      const domain = character.domainId && lore.domains?.[character.domainId]?.name
        ? lore.domains[character.domainId].name
        : character.domainId;
      lines.push([
        `- ${character.stableId}`,
        `currentName=${character.currentName}`,
        aliases?.length ? `aliases=${aliases.join(', ')}` : '',
        character.archetype ? `archetype=${character.archetype}` : '',
        domain ? `domain=${domain}` : '',
        character.summary || '',
      ].filter(Boolean).join('; '));
    }
  }

  const relationships = Object.values(lore.relationships || {});
  if (relationships.length) {
    lines.push('Bot relationships:');
    for (const relationship of relationships) {
      lines.push(`- ${relationship.label}: ${relationship.summary}`);
    }
  }

  const events = Object.values(lore.crossBotEvents || {});
  if (events.length) {
    lines.push('Cross-bot event hooks:');
    for (const event of events) {
      const signals = event.signals?.length ? ` Signals: ${event.signals.join(', ')}.` : '';
      lines.push(`- ${event.name}: ${event.usage || 'Use as a shared lore event.'}${signals}`);
    }
  }

  const livingLore = journal
    .filter((entry) => journalRelevant(entry, options))
    .slice(-Math.max(1, options.journalLimit || 12));
  if (livingLore.length) {
    lines.push('Living backstage lore and bot memories:');
    for (const entry of livingLore) {
      const participants = entry.participantBotNames.length
        ? entry.participantBotNames.join(', ')
        : entry.participantCharacterIds.join(', ');
      const tags = entry.interestTags.length ? ` Interests: ${entry.interestTags.join(', ')}.` : '';
      lines.push(`- ${participants || 'Station bots'}: ${entry.summary}${tags}`);
    }
  }

  return lines.join('\n');
}

export {
  getWorldLoreFilePath,
  getDefaultWorldLoreFilePath,
  getWorldLoreJournalFilePath,
};
