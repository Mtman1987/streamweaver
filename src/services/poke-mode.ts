import * as fs from 'fs/promises';
import * as path from 'path';

const MODE_PATH = path.resolve(process.cwd(), 'data', 'poke-mode.json');
let mode: 'chat' | 'overlay' = 'chat';

async function load() {
  try {
    const data = JSON.parse(await fs.readFile(MODE_PATH, 'utf-8'));
    if (data.mode === 'overlay' || data.mode === 'chat') mode = data.mode;
  } catch {}
}

async function save() {
  await fs.mkdir(path.dirname(MODE_PATH), { recursive: true });
  await fs.writeFile(MODE_PATH, JSON.stringify({ mode }));
}

load().catch(() => {});

export function getPokeMode(): 'chat' | 'overlay' { return mode; }

export async function togglePokeMode(): Promise<string> {
  mode = mode === 'chat' ? 'overlay' : 'chat';
  await save();
  return mode;
}
