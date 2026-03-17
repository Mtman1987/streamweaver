import * as fs from 'fs/promises';
import * as path from 'path';

const TEAMS_PATH = path.resolve(process.cwd(), 'data', 'gym-teams.json');
let teams: Record<string, string[]> = {};
let loaded = false;

async function load() {
  if (loaded) return;
  try {
    teams = JSON.parse(await fs.readFile(TEAMS_PATH, 'utf-8'));
  } catch {}
  loaded = true;
}

async function save() {
  await fs.mkdir(path.dirname(TEAMS_PATH), { recursive: true });
  await fs.writeFile(TEAMS_PATH, JSON.stringify(teams, null, 2));
}

export async function setGymTeam(username: string, cardIds: string[]): Promise<void> {
  await load();
  teams[username.toLowerCase()] = cardIds;
  await save();
}

export async function getGymTeam(username: string): Promise<string[] | null> {
  await load();
  return teams[username.toLowerCase()] || null;
}
