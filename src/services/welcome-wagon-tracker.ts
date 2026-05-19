import * as fs from 'fs/promises';
import { dirname, resolve } from 'path';
import { tenantPath } from '../lib/tenant';

interface WelcomeWagonData {
  shoutouts: Record<string, number>;
  excludedUsers: string[];
}

function trackerPath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'tokens/welcome-wagon-tracker.json');
  return resolve(process.cwd(), 'tokens', 'welcome-wagon-tracker.json');
}

const BLACKLISTED_BOTS = [
  'streamelements', 'nightbot', 'moobot', 'streamlabs', 'blerp',
  'fossabot', 'wizebot', 'botisimo', 'coebot', 'ankhbot',
  'deepbot', 'phantombot', 'vivbot', 'ohbot', 'supibot'
];

async function loadWelcomeWagonData(tenantId?: string): Promise<WelcomeWagonData> {
  try {
    const raw = await fs.readFile(trackerPath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      shoutouts: parsed?.shoutouts && typeof parsed.shoutouts === 'object' ? parsed.shoutouts : {},
      excludedUsers: Array.isArray(parsed?.excludedUsers)
        ? parsed.excludedUsers.filter((u: any): u is string => typeof u === 'string').map((u: string) => u.toLowerCase())
        : [],
    };
  } catch {
    return { shoutouts: {}, excludedUsers: [] };
  }
}

async function saveWelcomeWagonData(data: WelcomeWagonData, tenantId?: string): Promise<void> {
  const filePath = trackerPath(tenantId);
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function canShoutoutUser(username: string, tenantId?: string): Promise<boolean> {
  const data = await loadWelcomeWagonData(tenantId);
  const lower = username.toLowerCase();
  if (BLACKLISTED_BOTS.includes(lower)) return false;
  if (data.excludedUsers.includes(lower)) return false;
  const last = data.shoutouts[lower];
  if (last && Date.now() - last < 24 * 60 * 60 * 1000) return false;
  return true;
}

export async function getShoutoutCount(username: string, tenantId?: string): Promise<number> {
  const data = await loadWelcomeWagonData(tenantId);
  return data.shoutouts[username.toLowerCase()] ? 1 : 0;
}

export async function recordShoutout(username: string, tenantId?: string): Promise<void> {
  const data = await loadWelcomeWagonData(tenantId);
  data.shoutouts[username.toLowerCase()] = Date.now();
  await saveWelcomeWagonData(data, tenantId);
}

export async function addExcludedUser(username: string, tenantId?: string): Promise<void> {
  const data = await loadWelcomeWagonData(tenantId);
  const lower = username.toLowerCase();
  if (!data.excludedUsers.includes(lower)) {
    data.excludedUsers.push(lower);
    await saveWelcomeWagonData(data, tenantId);
  }
}

export async function removeExcludedUser(username: string, tenantId?: string): Promise<void> {
  const data = await loadWelcomeWagonData(tenantId);
  data.excludedUsers = data.excludedUsers.filter(u => u !== username.toLowerCase());
  await saveWelcomeWagonData(data, tenantId);
}

export async function getExcludedUsers(tenantId?: string): Promise<string[]> {
  const data = await loadWelcomeWagonData(tenantId);
  return data.excludedUsers;
}
