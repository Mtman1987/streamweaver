import * as fs from 'fs/promises';
import * as path from 'path';
import { tenantPath } from '../lib/tenant';

export interface StreamWeaverModes {
  gamblemode: 'overlay' | 'chat';
  welcomemode: 'overlay' | 'chat' | 'off';
  greetingmode: 'on' | 'off';
  clipmode: 'viewer' | 'broadcaster' | 'off';
  pokemode: 'overlay' | 'chat' | 'off';
  chatmode: 'single' | 'shared' | 'master-overlay' | 'master-chat';
  // Add more modes as needed
}

const DEFAULT_MODES: StreamWeaverModes = {
  gamblemode: 'overlay',
  welcomemode: 'overlay',
  greetingmode: 'on',
  clipmode: 'viewer',
  pokemode: 'overlay',
  chatmode: 'single',
};

function modesFilePath(tenantId?: string): string {
  if (tenantId) {
    return tenantPath(tenantId, 'data/modes.json');
  }
  return path.resolve(process.cwd(), 'data', 'modes.json');
}

const modeCache = new Map<string, StreamWeaverModes>();

function cacheKey(tenantId?: string): string {
  return tenantId || '__global__';
}

export async function loadModes(tenantId?: string): Promise<StreamWeaverModes> {
  const key = cacheKey(tenantId);
  const cached = modeCache.get(key);
  if (cached) return cached;

  try {
    await fs.mkdir(path.dirname(modesFilePath(tenantId)), { recursive: true });
    const data = await fs.readFile(modesFilePath(tenantId), 'utf-8');
    const parsed = JSON.parse(data);
    const modes: StreamWeaverModes = { ...DEFAULT_MODES, ...parsed };
    modeCache.set(key, modes);
    return modes;
  } catch {
    const defaultModes = { ...DEFAULT_MODES };
    await saveModes(defaultModes, tenantId);
    modeCache.set(key, defaultModes);
    return defaultModes;
  }
}

export async function saveModes(modes: StreamWeaverModes, tenantId?: string): Promise<void> {
  await fs.mkdir(path.dirname(modesFilePath(tenantId)), { recursive: true });
  modeCache.set(cacheKey(tenantId), modes);
  await fs.writeFile(modesFilePath(tenantId), JSON.stringify(modes, null, 2));
}

export async function getMode(modeName: keyof StreamWeaverModes, tenantId?: string): Promise<string> {
  const modes = await loadModes(tenantId);
  return modes[modeName] as string;
}

export async function toggleMode(
  modeName: keyof StreamWeaverModes, 
  tenantId?: string
): Promise<{ previous: string; current: string }> {
  const modes = await loadModes(tenantId);
  const current = modes[modeName] as string;
  
  let next: string;
  const toggles: Record<string, string[]> = {
    gamblemode: ['overlay', 'chat'],
    welcomemode: ['overlay', 'chat', 'off'],
    greetingmode: ['on', 'off'],
    clipmode: ['viewer', 'broadcaster', 'off'],
    pokemode: ['overlay', 'chat', 'off'],
    chatmode: ['single', 'shared', 'master-overlay', 'master-chat'],
  };
  
  const options = toggles[modeName] || [];
  const currentIndex = options.indexOf(current);
  next = options[(currentIndex + 1) % options.length];
  
  modes[modeName] = next as any;
  await saveModes(modes, tenantId);
  
  // Broadcast to overlays/dashboard
  if (typeof (global as any).broadcast === 'function') {
    (global as any).broadcast(
      { type: 'mode-toggled', mode: modeName, value: next, tenantId }, 
      tenantId
    );
  }
  
  return { previous: current, current: next };
}

export async function toggleMasterChatmode(tenantId?: string): Promise<void> {
  const modes = await loadModes(tenantId);
  const currentMaster = modes.chatmode;
  
  const nextMaster = currentMaster === 'master-overlay' ? 'master-chat' : 'master-overlay';
  modes.chatmode = nextMaster;
  
  // Toggle all sub-modes to match master
  const subModes = ['gamblemode', 'welcomemode', 'pokemode'] as (keyof StreamWeaverModes)[];
  subModes.forEach(mode => {
    modes[mode] = nextMaster.includes('overlay') ? 'overlay' : 'chat';
  });
  
  // Toggle binary modes
  modes.greetingmode = nextMaster.includes('overlay') ? 'on' : 'off';
  modes.clipmode = nextMaster.includes('overlay') ? 'viewer' : 'broadcaster';
  
  await saveModes(modes, tenantId);
  
  // Broadcast
  if (typeof (global as any).broadcast === 'function') {
    (global as any).broadcast(
      { type: 'master-mode-toggled', value: nextMaster, tenantId }, 
      tenantId
    );
  }
}

export async function getAllModes(tenantId?: string): Promise<StreamWeaverModes> {
  return await loadModes(tenantId);
}

