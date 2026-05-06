import { writeFile, readFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { tenantPath } from './tenant';

function ltmFilePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'tokens/ltm/memories.json');
  return resolve(process.cwd(), 'tokens', 'ltm', 'memories.json');
}

export type LTMEntry = {
  id: string;
  title: string; // Key phrase title
  content: string; // 5-10 sentence summary
  accessCount: number;
  createdAt: string;
  lastAccessedAt?: string;
};

export type LTMStore = {
  memories: LTMEntry[];
  messageCount: number; // Track total messages processed
};

export async function readLTMStore(tenantId?: string): Promise<LTMStore> {
  try {
    const filePath = ltmFilePath(tenantId);
    await mkdir(resolve(filePath, '..'), { recursive: true });
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { memories: [], messageCount: 0 };
  }
}

export async function writeLTMStore(store: LTMStore, tenantId?: string): Promise<void> {
  try {
    const filePath = ltmFilePath(tenantId);
    await mkdir(resolve(filePath, '..'), { recursive: true });
    await writeFile(filePath, JSON.stringify(store, null, 2));
  } catch (error) {
    console.error('[LTM] Failed to write store:', error);
  }
}

export async function addLTMEntry(title: string, content: string, tenantId?: string): Promise<void> {
  const store = await readLTMStore(tenantId);
  
  const entry: LTMEntry = {
    id: Date.now().toString(),
    title,
    content,
    accessCount: 0,
    createdAt: new Date().toISOString()
  };
  
  store.memories.push(entry);
  
  // Keep only 50 most recent/accessed memories
  if (store.memories.length > 50) {
    store.memories.sort((a, b) => {
      // Sort by access count (desc) then by creation date (desc)
      if (a.accessCount !== b.accessCount) {
        return b.accessCount - a.accessCount;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    store.memories = store.memories.slice(0, 50);
  }
  
  await writeLTMStore(store, tenantId);
}

export async function getLTMTitles(tenantId?: string): Promise<string[]> {
  const store = await readLTMStore(tenantId);
  return store.memories.map(m => m.title);
}

export async function getLTMContent(title: string, tenantId?: string): Promise<string | null> {
  const store = await readLTMStore(tenantId);
  const memory = store.memories.find(m => m.title === title);
  
  if (memory) {
    // Increment access count
    memory.accessCount++;
    memory.lastAccessedAt = new Date().toISOString();
    await writeLTMStore(store, tenantId);
    return memory.content;
  }
  
  return null;
}

export async function incrementMessageCount(tenantId?: string): Promise<number> {
  const store = await readLTMStore(tenantId);
  store.messageCount++;
  await writeLTMStore(store, tenantId);
  return store.messageCount;
}

export async function getMessageCount(tenantId?: string): Promise<number> {
  const store = await readLTMStore(tenantId);
  return store.messageCount;
}

export async function adjustMessageCount(adjustment: number, tenantId?: string): Promise<number> {
  const store = await readLTMStore(tenantId);
  store.messageCount += adjustment;
  await writeLTMStore(store, tenantId);
  return store.messageCount;
}