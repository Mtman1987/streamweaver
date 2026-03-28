import { uploadFileToDiscord, getChannelMessages, deleteMessage } from './discord';
import * as fs from 'fs';
import * as path from 'path';

const STORAGE_CHANNEL_ID = '1476540488147533895';
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
// Track Discord message IDs per user for clean updates
let discordMessageIds: Record<string, string> = {};
const DISCORD_IDS_FILE = path.join(process.cwd(), 'data', 'pokemon-discord-ids.json');

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

function loadDiscordIds(): void {
  try {
    if (fs.existsSync(DISCORD_IDS_FILE)) {
      discordMessageIds = JSON.parse(fs.readFileSync(DISCORD_IDS_FILE, 'utf-8'));
    }
  } catch {}
}

function saveDiscordIds(): void {
  ensureDataDir();
  fs.writeFileSync(DISCORD_IDS_FILE, JSON.stringify(discordMessageIds, null, 2));
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
          if (raw.messageId) discordMessageIds[key] = raw.messageId;
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

  loadDiscordIds();

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

// Fetch a user's collection from Discord (cross-stream import)
async function fetchUserFromDiscord(username: string): Promise<UserEntry | null> {
  try {
    const key = normalizePokemonUsername(username);
    const fileName = `${key}.json`;
    const messages = await getChannelMessages(STORAGE_CHANNEL_ID, 100);
    for (const msg of messages) {
      const att = msg.attachments?.find((a: any) => a.name === fileName);
      if (att) {
        const resp = await fetch(att.url);
        if (resp.ok) {
          const raw = await resp.json() as any;
          if (raw.cards && Array.isArray(raw.cards)) {
            discordMessageIds[key] = msg.id;
            saveDiscordIds();
            return {
              cards: raw.cards,
              packsOpened: raw.packsOpened || raw.packs || 0,
              updatedAt: raw.updatedAt || new Date().toISOString(),
              ...((raw.pendingPacks ?? undefined) !== undefined ? { pendingPacks: raw.pendingPacks } : {}),
            } as UserEntry;
          }
        }
      }
    }
  } catch (err) {
    console.error(`[Pokemon Storage] Discord fetch for ${username} failed:`, err);
  }
  return null;
}

// Upload a user's collection to Discord (so other streams can read it)
async function uploadUserToDiscord(username: string, entry: UserEntry): Promise<void> {
  try {
    const key = normalizePokemonUsername(username);
    const fileName = `${key}.json`;

    // Delete old message
    const oldId = discordMessageIds[key];
    if (oldId) {
      await deleteMessage(STORAGE_CHANNEL_ID, oldId).catch(() => {});
    }

    const result = await uploadFileToDiscord(
      STORAGE_CHANNEL_ID,
      JSON.stringify({ cards: entry.cards, packsOpened: entry.packsOpened, updatedAt: entry.updatedAt, ...(entry as any).pendingPacks !== undefined ? { pendingPacks: (entry as any).pendingPacks } : {} }, null, 2),
      fileName,
      `User: ${username} | ${entry.cards.length} cards, ${entry.packsOpened} packs opened`
    );

    if (result?.data && (result.data as any).id) {
      discordMessageIds[key] = (result.data as any).id;
      saveDiscordIds();
      console.log(`[Pokemon Storage] Uploaded ${username} to Discord: ${entry.cards.length} cards`);
    }
  } catch (err) {
    console.error(`[Pokemon Storage] Discord upload for ${username} failed:`, err);
  }
}

export async function getUserCollection(username: string): Promise<UserCollection> {
  const data = await init();
  const key = normalizePokemonUsername(username);

  // If we have local data, use it
  if (data[key]) {
    return { cards: data[key].cards, packsOpened: data[key].packsOpened || 0, updatedAt: data[key].updatedAt, deck: data[key].deck };
  }

  // First time seeing this user — check Discord for cross-stream data
  const remote = await fetchUserFromDiscord(username);
  if (remote) {
    data[key] = remote;
    saveLocal();
    console.log(`[Pokemon Storage] Imported ${username} from Discord: ${remote.cards.length} cards`);
    return { cards: remote.cards, packsOpened: remote.packsOpened, updatedAt: remote.updatedAt, ...(remote as any).pendingPacks !== undefined ? { pendingPacks: (remote as any).pendingPacks } : {} };
  }

  return { cards: [], packsOpened: 0, updatedAt: new Date().toISOString() };
}

export async function getAllCollections(): Promise<AllCollections> {
  return await init();
}

export async function importAllFromDiscord(): Promise<number> {
  const data = await init();
  let imported = 0;
  try {
    const messages = await getChannelMessages(STORAGE_CHANNEL_ID, 100);
    for (const msg of messages) {
      for (const att of (msg.attachments || [])) {
        if (!att.name?.endsWith('.json')) continue;
        const username = att.name.replace('.json', '').toLowerCase();
        if (data[username]) continue; // already have this user
        try {
          const resp = await fetch(att.url);
          if (!resp.ok) continue;
          const raw = await resp.json() as any;
          if (!raw.cards || !Array.isArray(raw.cards)) continue;
          data[username] = {
            cards: raw.cards,
            packsOpened: raw.packsOpened || raw.packs || 0,
            updatedAt: raw.updatedAt || new Date().toISOString(),
          };
          discordMessageIds[username] = msg.id;
          imported++;
          console.log(`[Pokemon Storage] Imported ${username} from Discord: ${raw.cards.length} cards`);
        } catch {}
      }
    }
    if (imported > 0) {
      saveLocal();
      saveDiscordIds();
    }
  } catch (err) {
    console.error('[Pokemon Storage] importAllFromDiscord failed:', err);
  }
  return imported;
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

  // Upload to Discord so other streams can see the updated collection
  uploadUserToDiscord(username, entry).catch(err =>
    console.error(`[Pokemon Storage] Background Discord upload failed for ${username}:`, err)
  );
}

export async function importByMessageId(username: string, messageId: string): Promise<boolean> {
  const data = await init();
  const key = normalizePokemonUsername(username);
  try {
    const { getDiscordMessage } = await import('./discord');
    const msg: any = await getDiscordMessage(STORAGE_CHANNEL_ID, messageId);
    if (!msg?.attachments?.length) {
      console.error(`[Pokemon Storage] No attachments on message ${messageId}`);
      return false;
    }
    const att = msg.attachments.find((a: any) => a.name?.endsWith('.json'));
    if (!att) return false;
    const resp = await fetch(att.url);
    if (!resp.ok) return false;
    const raw = await resp.json() as any;
    const cards = raw.cards || raw;
    if (!Array.isArray(cards)) return false;
    // Normalize cards — old format might have different fields
    const normalized = cards.map((c: any) => ({
      name: c.name || 'Unknown',
      number: c.number || c.id || '',
      setCode: c.setCode || c.set || '',
      rarity: c.rarity || 'Common',
      imageUrl: c.imageUrl || c.image || '',
      seasonId: c.seasonId || 'imported',
      openedAt: c.openedAt || '',
    }));
    data[key] = {
      cards: normalized,
      packsOpened: raw.packsOpened || raw.packs || 0,
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
    discordMessageIds[key] = messageId;
    saveLocal();
    saveDiscordIds();
    console.log(`[Pokemon Storage] Imported ${username} from message ${messageId}: ${normalized.length} cards`);
    return true;
  } catch (err) {
    console.error(`[Pokemon Storage] importByMessageId failed for ${username}:`, err);
    return false;
  }
}
