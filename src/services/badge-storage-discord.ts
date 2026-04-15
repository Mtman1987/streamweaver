import * as fs from 'fs';
import * as path from 'path';

const LOCAL_FILE = path.join(process.cwd(), 'data', 'gym-badges.json');

type BadgeStore = Record<string, string[]>;

let store: BadgeStore | null = null;

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

async function init(): Promise<BadgeStore> {
  if (store) return store;
  store = loadLocal();
  return store;
}

export async function getUserBadges(username: string): Promise<string[]> {
  const data = await init();
  const key = username.toLowerCase();
  return data[key] || [];
}

export async function saveUserBadges(username: string, badges: string[]): Promise<void> {
  const data = await init();
  const key = username.toLowerCase();
  data[key] = badges;
  saveLocal();
}
