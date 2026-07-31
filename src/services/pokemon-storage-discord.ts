import * as fs from 'fs';
import * as path from 'path';

const LOCAL_FILE = path.join(process.cwd(), 'data', 'pokemon-collections.json');
const LEGACY_COLLECTIONS_FILE = path.join(process.cwd(), 'src', 'data', 'pokemon-collections.json');

type Card = {
  name: string;
  number: string;
  setCode: string;
  rarity: string;
  imageUrl?: string;
  seasonId?: string;
  openedAt?: string;
};

type UserEntry = { cards: Card[]; packsOpened: number; updatedAt: string; deck?: { cards: number[]; energy: Record<string, number> } };
type AllCollections = Record<string, UserEntry>;

type UserCollection = {
  cards: Card[];
  packsOpened: number;
  updatedAt: string;
  deck?: { cards: number[]; energy: Record<string, number> };
  pendingPacks?: number;
};

// In-memory store, loaded once from disk
let store: AllCollections | null = null;

function ensureDataDir(): void {
  const dir = path.dirname(LOCAL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function normalizePokemonUsername(username: string): string {
  return username.trim().replace(/^@+/, '').toLowerCase();
}

function cardSignature(card: Card): string {
  return [
    card.name || '',
    card.number || '',
    card.setCode || '',
    card.rarity || '',
    card.seasonId || '',
    card.openedAt || '',
    card.imageUrl || '',
  ].join('|');
}

function mergeEntries(existing: UserEntry | undefined, incoming: Partial<UserEntry> | undefined): UserEntry {
  const mergedCards = [...(existing?.cards || []), ...(incoming?.cards || [])];
  const seen = new Set<string>();
  const cards = mergedCards.filter(card => {
    const key = cardSignature(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    cards,
    packsOpened: Math.max(existing?.packsOpened || 0, incoming?.packsOpened || 0),
    updatedAt: [existing?.updatedAt, incoming?.updatedAt].filter(Boolean).sort().slice(-1)[0] || new Date().toISOString(),
    ...(existing?.deck ? { deck: existing.deck } : {}),
    ...(incoming?.deck ? { deck: incoming.deck } : {}),
    ...((existing as any)?.pendingPacks !== undefined || (incoming as any)?.pendingPacks !== undefined
      ? { pendingPacks: Math.max((existing as any)?.pendingPacks || 0, (incoming as any)?.pendingPacks || 0) }
      : {}),
  };
}

function normalizeStore(raw: AllCollections): AllCollections {
  const normalized: AllCollections = {};
  for (const [username, entry] of Object.entries(raw || {})) {
    const key = normalizePokemonUsername(username);
    normalized[key] = mergeEntries(normalized[key], entry);
  }
  return normalized;
}

function loadLocal(): AllCollections {
  try {
    if (fs.existsSync(LOCAL_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf-8'));
      console.log(`[Pokemon Storage] Loaded local: ${Object.keys(raw).length} users`);
      return normalizeStore(raw);
    }
  } catch (err) {
    console.error('[Pokemon Storage] Failed to read local file:', err);
  }
  return {};
}

function saveLocal(): void {
  if (!store) return;
  ensureDataDir();
  const tmp = `${LOCAL_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, LOCAL_FILE);
}

async function migrateOldFiles(): Promise<AllCollections> {
  const migrated: AllCollections = {};
  // Migrate old per-user local backups
  const oldDir = path.join(process.cwd(), 'data', 'pokemon-users');
  if (fs.existsSync(oldDir)) {
    const files = fs.readdirSync(oldDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const username = file.replace('.json', '');
        const raw = JSON.parse(fs.readFileSync(path.join(oldDir, file), 'utf-8'));
        if (raw.cards && Array.isArray(raw.cards)) {
          const key = normalizePokemonUsername(username);
          migrated[key] = mergeEntries(migrated[key], { cards: raw.cards, packsOpened: raw.packsOpened || raw.packs || 0, updatedAt: raw.updatedAt || new Date().toISOString() } as UserEntry);
        }
      } catch {}
    }
    if (Object.keys(migrated).length > 0) {
      console.log(`[Pokemon Storage] Migrated ${Object.keys(migrated).length} users from old per-user files`);
    }
  }
  return migrated;
}

async function migrateLegacyCollectionsFile(): Promise<AllCollections> {
  const migrated: AllCollections = {};
  try {
    if (!fs.existsSync(LEGACY_COLLECTIONS_FILE)) return migrated;
    const raw = JSON.parse(fs.readFileSync(LEGACY_COLLECTIONS_FILE, 'utf-8'));
    for (const [username, entry] of Object.entries(raw || {})) {
      const legacy = entry as any;
      if (!legacy?.cards || !Array.isArray(legacy.cards)) continue;
      const key = normalizePokemonUsername(username);
      migrated[key] = mergeEntries(migrated[key], {
        cards: legacy.cards.map((card: any) => ({
          name: card.name || 'Unknown',
          number: card.number || '',
          setCode: card.setCode || card.set || '',
          rarity: card.rarity || 'Common',
          imageUrl: card.imageUrl || card.imagePath || '',
          seasonId: card.seasonId,
          openedAt: card.openedAt,
        })),
        packsOpened: legacy.packsOpened || legacy.packs || 0,
        updatedAt: legacy.updatedAt || new Date().toISOString(),
      } as UserEntry);
    }
    if (Object.keys(migrated).length > 0) {
      console.log(`[Pokemon Storage] Migrated ${Object.keys(migrated).length} users from legacy collections file`);
    }
  } catch (err) {
    console.error('[Pokemon Storage] Failed migrating legacy collections:', err);
  }
  return migrated;
}

async function init(): Promise<AllCollections> {
  if (store) return store;

  // Local file is source of truth
  let data = loadLocal();

  // If empty, try migrating old format
  if (Object.keys(data).length === 0) {
    data = await migrateOldFiles();
  }

  const legacyData = await migrateLegacyCollectionsFile();
  if (Object.keys(legacyData).length > 0) {
    const merged = { ...data };
    for (const [username, entry] of Object.entries(legacyData)) {
      merged[username] = mergeEntries(merged[username], entry);
    }
    data = normalizeStore(merged);
  }

  store = data;
  if (Object.keys(data).length > 0) saveLocal();
  return store;
}

export async function getUserCollection(username: string): Promise<UserCollection> {
  const data = await init();
  const key = normalizePokemonUsername(username);

  // If we have local data, use it
  if (data[key]) {
    return { cards: data[key].cards, packsOpened: data[key].packsOpened || 0, updatedAt: data[key].updatedAt, deck: data[key].deck };
  }

  return { cards: [], packsOpened: 0, updatedAt: new Date().toISOString() };
}

export async function getAllCollections(): Promise<AllCollections> {
  return await init();
}



export async function saveUserCollection(username: string, collection: UserCollection): Promise<void> {
  const data = await init();
  const key = normalizePokemonUsername(username);
  const entry: UserEntry = {
    cards: collection.cards,
    packsOpened: collection.packsOpened,
    updatedAt: new Date().toISOString(),
    ...(collection.deck ? { deck: collection.deck } : {}),
    ...(collection.pendingPacks !== undefined ? { pendingPacks: collection.pendingPacks } : {}),
  };

  data[key] = entry;
  saveLocal();
  console.log(`[Pokemon Storage] Saved ${username}: ${collection.cards.length} cards, ${collection.packsOpened} packs opened`);
}

export async function swapPokemonCards(input: {
  userA: string;
  userB: string;
  cardIndexA: number;
  cardIndexB: number;
  expectedA: { setCode: string; number: string; openedAt?: string };
  expectedB: { setCode: string; number: string; openedAt?: string };
}): Promise<{ cardA: Card; cardB: Card }> {
  const data = await init();
  const keyA = normalizePokemonUsername(input.userA);
  const keyB = normalizePokemonUsername(input.userB);
  if (!keyA || !keyB || keyA === keyB) throw new Error('A trade requires two different linked collections.');

  const entryA = data[keyA];
  const entryB = data[keyB];
  const cardA = entryA?.cards?.[input.cardIndexA];
  const cardB = entryB?.cards?.[input.cardIndexB];
  const matches = (card: Card | undefined, expected: { setCode: string; number: string; openedAt?: string }) =>
    Boolean(
      card &&
      card.setCode === expected.setCode &&
      card.number === expected.number &&
      (!expected.openedAt || card.openedAt === expected.openedAt)
    );

  if (!matches(cardA, input.expectedA)) throw new Error(`${input.userA}'s offered card is no longer available.`);
  if (!matches(cardB, input.expectedB)) throw new Error(`${input.userB}'s offered card is no longer available.`);

  entryA.cards[input.cardIndexA] = cardB;
  entryB.cards[input.cardIndexB] = cardA;
  entryA.updatedAt = new Date().toISOString();
  entryB.updatedAt = entryA.updatedAt;
  saveLocal();
  return { cardA, cardB };
}


