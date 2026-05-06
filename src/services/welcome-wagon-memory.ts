import { promises as fs } from 'fs';
import { resolve } from 'path';
import { tenantPath } from '../lib/tenant';

function memoryFilePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/welcome-wagon-memory.json');
  return resolve(process.cwd(), 'data', 'welcome-wagon-memory.json');
}

type WelcomeMemory = {
  welcomedUsers: string[];
};

async function loadMemory(tenantId?: string): Promise<WelcomeMemory> {
  try {
    const raw = await fs.readFile(memoryFilePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw) as WelcomeMemory;
    return {
      welcomedUsers: Array.isArray(parsed.welcomedUsers) ? parsed.welcomedUsers : [],
    };
  } catch {
    return { welcomedUsers: [] };
  }
}

async function saveMemory(memory: WelcomeMemory, tenantId?: string): Promise<void> {
  const filePath = memoryFilePath(tenantId);
  await fs.mkdir(resolve(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(memory, null, 2));
}

export async function shouldWelcomeUser(username: string, tenantId?: string): Promise<boolean> {
  const memory = await loadMemory(tenantId);
  return !memory.welcomedUsers.includes(username.toLowerCase());
}

export async function markUserWelcomed(username: string, tenantId?: string): Promise<void> {
  const memory = await loadMemory(tenantId);
  const normalized = username.toLowerCase();
  if (!memory.welcomedUsers.includes(normalized)) {
    memory.welcomedUsers.push(normalized);
    await saveMemory(memory, tenantId);
  }
}