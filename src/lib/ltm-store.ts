import { writeFile, readFile, mkdir } from 'fs/promises';
import { resolve } from 'path';

const LTM_DIR = resolve(process.cwd(), 'tokens', 'ltm');
const LTM_FILE = resolve(LTM_DIR, 'memories.json');

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

export async function readLTMStore(): Promise<LTMStore> {
  try {
    await mkdir(LTM_DIR, { recursive: true });
    const data = await readFile(LTM_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { memories: [], messageCount: 0 };
  }
}

export async function writeLTMStore(store: LTMStore): Promise<void> {
  try {
    await mkdir(LTM_DIR, { recursive: true });
    await writeFile(LTM_FILE, JSON.stringify(store, null, 2));
  } catch (error) {
    console.error('[LTM] Failed to write store:', error);
  }
}

export async function addLTMEntry(title: string, content: string): Promise<void> {
  const store = await readLTMStore();
  
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
  
  await writeLTMStore(store);
}

export async function getLTMTitles(): Promise<string[]> {
  const store = await readLTMStore();
  return store.memories.map(m => m.title);
}

export async function getLTMContent(title: string): Promise<string | null> {
  const store = await readLTMStore();
  const memory = store.memories.find(m => m.title === title);
  
  if (memory) {
    // Increment access count
    memory.accessCount++;
    memory.lastAccessedAt = new Date().toISOString();
    await writeLTMStore(store);
    return memory.content;
  }
  
  return null;
}

export async function incrementMessageCount(): Promise<number> {
  const store = await readLTMStore();
  store.messageCount++;
  await writeLTMStore(store);
  return store.messageCount;
}

export async function getMessageCount(): Promise<number> {
  const store = await readLTMStore();
  return store.messageCount;
}

export async function adjustMessageCount(adjustment: number): Promise<number> {
  const store = await readLTMStore();
  store.messageCount += adjustment;
  await writeLTMStore(store);
  return store.messageCount;
}