import { uploadFileToDiscord, getChannelMessages, deleteMessage } from './discord';
import * as fs from 'fs';
import * as path from 'path';

const STORAGE_CHANNEL_ID = '1476540488147533895';
const LOCAL_FILE = path.join(process.cwd(), 'data', 'pokemon-collections.json');

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
      return raw;
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
          migrated[username] = { cards: raw.cards, packsOpened: raw.packsOpened || raw.packs || 0, updatedAt: raw.updatedAt || new Date().toISOString() };
          if (raw.messageId) discordMessageIds[username] = raw.messageId;
        }
      } catch {}
    }
    if (Object.keys(migrated).length > 0) {
      console.log(`[Pokemon Storage] Migrated ${Object.keys(migrated).length} users from old per-user files`);
    }
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

  store = data;
  if (Object.keys(data).length > 0) saveLocal();
  return store;
}

// Fetch a user's collection from Discord (cross-stream import)
async function fetchUserFromDiscord(username: string): Promise<UserEntry | null> {
  try {
    const fileName = `${username.toLowerCase()}.json`;
    const messages = await getChannelMessages(STORAGE_CHANNEL_ID, 100);
    for (const msg of messages) {
      const att = msg.attachments?.find((a: any) => a.name === fileName);
      if (att) {
        const resp = await fetch(att.url);
        if (resp.ok) {
          const raw = await resp.json() as any;
          if (raw.cards && Array.isArray(raw.cards)) {
            discordMessageIds[username.toLowerCase()] = msg.id;
            saveDiscordIds();
            return { cards: raw.cards, packsOpened: raw.packsOpened || raw.packs || 0, updatedAt: raw.updatedAt || new Date().toISOString() };
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
    const key = username.toLowerCase();
    const fileName = `${key}.json`;

    // Delete old message
    const oldId = discordMessageIds[key];
    if (oldId) {
      await deleteMessage(STORAGE_CHANNEL_ID, oldId).catch(() => {});
    }

    const result = await uploadFileToDiscord(
      STORAGE_CHANNEL_ID,
      JSON.stringify({ cards: entry.cards, packsOpened: entry.packsOpened, updatedAt: entry.updatedAt }, null, 2),
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
  const key = username.toLowerCase();

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
    return { cards: remote.cards, packsOpened: remote.packsOpened, updatedAt: remote.updatedAt };
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
  const key = username.toLowerCase();
  const entry: UserEntry = {
    cards: collection.cards,
    packsOpened: collection.packsOpened,
    updatedAt: new Date().toISOString(),
    ...(collection.deck ? { deck: collection.deck } : {}),
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
  const key = username.toLowerCase();
  try {
    const { getDiscordMessage } = await import('./discord');
    const msg = await getDiscordMessage(STORAGE_CHANNEL_ID, messageId);
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
