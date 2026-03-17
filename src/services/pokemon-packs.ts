import fs from 'fs';
import path from 'path';
import { addCardsToUser } from './pokemon-collection';

const CARDS_DB_DIR = path.join(process.cwd(), 'pokemon-tcg-data-master', 'cards', 'en');
const SETS_FILE = path.join(process.cwd(), 'pokemon-tcg-data-master', 'sets', 'en.json');

let allSetsCache: { id: string; name: string }[] | null = null;

function loadAllSets(): { id: string; name: string }[] {
  if (allSetsCache) return allSetsCache;
  try {
    const raw = JSON.parse(fs.readFileSync(SETS_FILE, 'utf-8'));
    allSetsCache = raw.map((s: any) => ({ id: s.id, name: s.name }));
    return allSetsCache!;
  } catch {
    return [];
  }
}

/** Build the numbered set menu from enabledSets config. Returns map of 1-based index to {code, name}. */
export function getEnabledSetMap(enabledSets: string[]): Record<number, { code: string; name: string }> {
  const all = loadAllSets();
  const map: Record<number, { code: string; name: string }> = {};
  let idx = 1;
  for (const setId of enabledSets) {
    const info = all.find(s => s.id === setId);
    if (info && fs.existsSync(path.join(CARDS_DB_DIR, `${setId}.json`))) {
      map[idx++] = { code: setId, name: info.name };
    }
  }
  return map;
}

/** Format the set list string for chat. */
export function formatSetList(setMap: Record<number, { code: string; name: string }>): string {
  const entries = Object.entries(setMap).map(([n, s]) => `${n}.${s.name}`);
  return `PokePacks: ${entries.join(' ')}`;
}

function pickRandom(arr: any[], count: number): any[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export async function openPack(setNumber: number, username: string, enabledSets?: string[]) {
  // Load enabled sets from config if not provided
  let sets = enabledSets;
  if (!sets) {
    try {
      const { getConfigSection } = require('../lib/local-config/service');
      const cfg = await getConfigSection('redeems');
      sets = cfg.pokePack.enabledSets;
    } catch {
      sets = ['base1', 'base2', 'base3', 'base4', 'base5', 'gym1'];
    }
  }

  const setMap = getEnabledSetMap(sets!);
  const setInfo = setMap[setNumber];
  if (!setInfo) return null;

  const filePath = path.join(CARDS_DB_DIR, `${setInfo.code}.json`);
  if (!fs.existsSync(filePath)) return null;

  const cardData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  const common = cardData.filter((c: any) => c.rarity === 'Common');
  const uncommon = cardData.filter((c: any) => c.rarity === 'Uncommon');
  const rare = cardData.filter((c: any) => c.rarity === 'Rare' || c.rarity === 'Rare Holo');
  const other = cardData.filter((c: any) => c.supertype === 'Energy' || c.supertype === 'Trainer');

  if (common.length < 4 || uncommon.length < 3 || rare.length < 1 || other.length < 1) {
    console.log(`[Pokemon] Not enough cards in ${setInfo.name}`);
    return null;
  }

  const pack = [
    ...pickRandom(common, 4),
    ...pickRandom(uncommon, 3),
    ...pickRandom(rare, 1),
    ...pickRandom(other, 1)
  ].map(card => ({
    name: card.name,
    number: card.number,
    setCode: setInfo.code,
    rarity: card.rarity || 'Common',
    imageUrl: card.images?.large || `https://images.pokemontcg.io/${setInfo.code}/${card.number}.png`
  }));

  console.log(`[Pokemon] ${username} opened ${setInfo.name} pack`);
  await addCardsToUser(username, pack);

  if (typeof (global as any).broadcast === 'function') {
    const payload = { pack, setName: setInfo.name, username };
    (global as any).broadcast({ type: 'pokemon-pack-open', payload });
    (global as any).broadcast({ type: 'pokemon-pack-opened', payload });
  }

  return { pack, setName: setInfo.name, setCode: setInfo.code, username };
}
