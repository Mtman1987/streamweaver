import { promises as fs } from 'fs';
import path from 'path';
import { readUserConfigSync } from '@/lib/user-config';

function getUserDataRoot(): string {
  const config = readUserConfigSync();
  const username = config.TWITCH_BROADCASTER_USERNAME || 'default';
  return path.resolve(process.cwd(), 'data', username);
}

const ALLOW_FILE_IO = true; // Always enabled

// Mutex for file writing to prevent race conditions
const fileLocks: Map<string, Promise<void>> = new Map();

// Debug log to see what's happening
console.log('[Storage] File IO is always enabled');

async function ensureDataDir() {
  const dataRoot = getUserDataRoot();
  await fs.mkdir(dataRoot, { recursive: true });
}

async function checkPermission() {
  // Always allow file IO
}

/**
 * Acquires a lock for a specific file to prevent concurrent writes
 * This prevents race conditions when multiple processes try to write to the same file
 */
async function acquireLock(fileName: string): Promise<() => void> {
  // Wait for any existing lock to be released
  while (fileLocks.has(fileName)) {
    await fileLocks.get(fileName);
  }
  
  let releaseLock: (() => void) | undefined;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  
  fileLocks.set(fileName, lockPromise);
  
  return releaseLock!;
}

/**
 * Releases the lock for a specific file
 */
function releaseLockForFile(fileName: string, releaseFn: () => void): void {
  fileLocks.delete(fileName);
  releaseFn();
}

export async function readJsonFile<T = any>(fileName: string, defaultValue: T): Promise<T> {
  await checkPermission();
  await ensureDataDir();
  const dataRoot = getUserDataRoot();
  const filePath = path.join(dataRoot, fileName);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return defaultValue;
    }
    throw error;
  }
}

export async function writeJsonFile(fileName: string, data: any): Promise<void> {
  await checkPermission();
  await ensureDataDir();
  const dataRoot = getUserDataRoot();
  const filePath = path.join(dataRoot, fileName);
  
  // Acquire lock to prevent race conditions
  const release = await acquireLock(fileName);
  
  try {
    // Write to a temporary file first, then rename (atomic write)
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    
    // Atomic rename - this ensures the file is either fully written or not
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  } finally {
    // Always release the lock
    releaseLockForFile(fileName, release);
  }
}
