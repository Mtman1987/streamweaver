import { uploadFileToDiscord, getChannelMessages, deleteMessage } from './discord';
import * as fs from 'fs';
import * as path from 'path';

const BADGE_CHANNEL_ID = '1476540488147533895'; // Same storage channel
const LOCAL_FILE = path.join(process.cwd(), 'data', 'gym-badges.json');
const DISCORD_IDS_FILE = path.join(process.cwd(), 'data', 'badge-discord-ids.json');

type BadgeStore = Record<string, string[]>;

let store: BadgeStore | null = null;
let discordMessageIds: Record<string, string> = {};

function ensureDataDir(): void {
  const dir = path.dirname(LOCAL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadLocal(): BadgeStore {
  try {
    if (fs.existsSync(LOCAL_FILE)) return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf-8'));
  } catch {}
  return {};
}

function saveLocal(): void {
  if (!store) return;
  ensureDataDir();
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(store, null, 2));
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

async function init(): Promise<BadgeStore> {
  if (store) return store;
  loadDiscordIds();
  store = loadLocal();
  return store;
}

export async function getUserBadgesFromDiscord(username: string): Promise<string[]> {
  const data = await init();
  const key = username.toLowerCase();
  if (data[key]) return data[key];

  // Try fetching from Discord
  try {
    const fileName = `badges_${key}.json`;
    const messages = await getChannelMessages(BADGE_CHANNEL_ID, 100);
    for (const msg of messages) {
      const att = msg.attachments?.find((a: any) => a.name === fileName);
      if (att) {
        const resp = await fetch(att.url);
        if (resp.ok) {
          const raw = await resp.json() as any;
          if (Array.isArray(raw.badges)) {
            data[key] = raw.badges;
            discordMessageIds[key] = msg.id;
            saveDiscordIds();
            saveLocal();
            return raw.badges;
          }
        }
      }
    }
  } catch (err) {
    console.error(`[Badge Storage] Discord fetch for ${username} failed:`, err);
  }
  return [];
}

export async function saveUserBadgesToDiscord(username: string, badges: string[]): Promise<void> {
  const data = await init();
  const key = username.toLowerCase();
  data[key] = badges;
  saveLocal();

  try {
    const fileName = `badges_${key}.json`;
    const oldId = discordMessageIds[key];
    if (oldId) await deleteMessage(BADGE_CHANNEL_ID, oldId).catch(() => {});

    const result = await uploadFileToDiscord(
      BADGE_CHANNEL_ID,
      JSON.stringify({ badges, updatedAt: new Date().toISOString() }, null, 2),
      fileName,
      `Gym badges for ${username}: ${badges.length} badges`
    );

    if (result?.data && (result.data as any).id) {
      discordMessageIds[key] = (result.data as any).id;
      saveDiscordIds();
    }
  } catch (err) {
    console.error(`[Badge Storage] Discord upload for ${username} failed:`, err);
  }
}
