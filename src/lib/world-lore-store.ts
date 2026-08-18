import { promises as fs } from 'fs';
import { resolve } from 'path';
import { globalPath } from './tenant';
import { THE_COUNT_CHARACTER } from './the-count';

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

function getWorldLoreFilePath(): string {
  return globalPath('world-lore.json');
}

function getDefaultWorldLoreFilePath(): string {
  return resolve(process.cwd(), 'src', 'data', 'world-lore-default.json');
}

function withSystemCharacters(lore: WorldLore): WorldLore {
  return {
    ...lore,
    characters: {
      ...(lore.characters || {}),
      [THE_COUNT_CHARACTER.stableId]: THE_COUNT_CHARACTER,
    },
  };
}

export async function readWorldLore(): Promise<WorldLore | null> {
  for (const filePath of [getWorldLoreFilePath(), getDefaultWorldLoreFilePath()]) {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.worldId !== 'string') {
        continue;
      }
      return withSystemCharacters(parsed as WorldLore);
    } catch {
      // Try the next source.
    }
  }
  return null;
}

export async function formatWorldLoreForPrompt(): Promise<string> {
  const lore = await readWorldLore();
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

  return lines.join('\n');
}

export { getWorldLoreFilePath, getDefaultWorldLoreFilePath };
