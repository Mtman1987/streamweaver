import { promises as fs } from 'fs';
import { resolve } from 'path';

const MEMORY_FILE = resolve(process.cwd(), 'data', 'welcome-wagon-memory.json');

type WelcomeMemory = {
  welcomedUsers: string[];
};

async function loadMemory(): Promise<WelcomeMemory> {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as WelcomeMemory;
    return {
      welcomedUsers: Array.isArray(parsed.welcomedUsers) ? parsed.welcomedUsers : [],
    };
  } catch {
    return { welcomedUsers: [] };
  }
}

async function saveMemory(memory: WelcomeMemory): Promise<void> {
  await fs.mkdir(resolve(process.cwd(), 'data'), { recursive: true });
  await fs.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

export async function shouldWelcomeUser(username: string): Promise<boolean> {
  const memory = await loadMemory();
  return !memory.welcomedUsers.includes(username.toLowerCase());
}

export async function markUserWelcomed(username: string): Promise<void> {
  const memory = await loadMemory();
  const normalized = username.toLowerCase();
  if (!memory.welcomedUsers.includes(normalized)) {
    memory.welcomedUsers.push(normalized);
    await saveMemory(memory);
  }
}