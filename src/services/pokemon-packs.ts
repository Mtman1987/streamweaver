import fs from 'fs';
import path from 'path';
import { addCardsToUser } from './pokemon-collection';
import { normalizeCardPackEvent } from '@/lib/card-pack-event';

const CARDS_DB_DIR = path.join(process.cwd(), 'pokemon-tcg-data-master', 'cards', 'en');
const SETS_FILE = path.join(process.cwd(), 'pokemon-tcg-data-master', 'sets', 'en.json');

let allSetsCache: { id: string; name: string }[] | null = null;
export const POKEMON_PACK_SIZE = 9;

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

export function formatSetList(setMap: Record<number, { code: string; name: string }>): string {
  const entries = Object.entries(setMap).map(([n, s]) => `${n}.${s.name}`);
  return `PokePacks: ${entries.join(' ')}`;
}

function pickRandom(arr: any[], count: number): any[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function normalizeTenantId(tenantId?: string): string | undefined {
  if (tenantId?.startsWith('__kick_silent__:')) return tenantId.slice('__kick_silent__:'.length);
  return tenantId;
}

function broadcastPack(pack: any[], setName: string, username: string, tenantId?: string, eventId?: string) {
  const canonical = normalizeCardPackEvent({
    eventId: eventId || `pokemon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    game: 'pokemon',
    pack,
    setName,
    username,
  });
  if (typeof (global as any).broadcast === 'function') {
    const broadcastTenantId = normalizeTenantId(tenantId);
    const legacyPayload = { eventId: canonical.eventId, pack, setName, username, game: 'pokemon' };
    (global as any).broadcast({ type: 'card-pack-opened', payload: canonical }, broadcastTenantId);
    (global as any).broadcast({ type: 'pokemon-pack-opened', payload: legacyPayload }, broadcastTenantId);
  }
  return canonical.eventId;
}

export async function openPack(setNumber: number, username: string, enabledSets?: string[], tenantId?: string) {
  let sets = enabledSets;
  if (!sets) {
    try {
      const { getConfigSection } = require('../lib/local-config/service');
      const cfg = await getConfigSection('redeems', tenantId);
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

  let picked: any[];
  if (common.length >= 4 && uncommon.length >= 3 && rare.length >= 1 && other.length >= 1) {
    picked = [...pickRandom(common, 4), ...pickRandom(uncommon, 3), ...pickRandom(rare, 1), ...pickRandom(other, 1)];
  } else if (cardData.length >= POKEMON_PACK_SIZE) {
    picked = pickRandom(cardData, POKEMON_PACK_SIZE);
    console.log(`[Pokemon] ${setInfo.name} uses fallback pack (non-standard rarities)`);
  } else {
    console.log(`[Pokemon] Not enough cards in ${setInfo.name} (${cardData.length} total)`);
    return null;
  }

  const pack = picked.map(card => ({
    name: card.name,
    number: card.number,
    setCode: setInfo.code,
    rarity: card.rarity || 'Common',
    imageUrl: card.images?.large || `https://images.pokemontcg.io/${setInfo.code}/${card.number}.png`,
  }));

  console.log(`[Pokemon] ${username} opened ${setInfo.name} pack`);
  await addCardsToUser(username, pack);
  const eventId = broadcastPack(pack, setInfo.name, username, tenantId);
  return { pack, setName: setInfo.name, setCode: setInfo.code, username, eventId };
}

const EEVEE_DEX = new Set([133, 134, 135, 136, 196, 197, 470, 471, 700]);
let eeveePoolCache: any[] | null = null;

function loadEeveePool(): any[] {
  if (eeveePoolCache) return eeveePoolCache;
  const pool: any[] = [];
  for (const file of fs.readdirSync(CARDS_DB_DIR).filter((f: string) => f.endsWith('.json'))) {
    const setCode = file.replace('.json', '');
    const cards = JSON.parse(fs.readFileSync(path.join(CARDS_DB_DIR, file), 'utf-8'));
    for (const c of cards) {
      if ((c.nationalPokedexNumbers || []).some((n: number) => EEVEE_DEX.has(n))) {
        pool.push({ ...c, _setCode: setCode });
      }
    }
  }
  eeveePoolCache = pool;
  return pool;
}

export async function openEeveePack(username: string, tenantId?: string) {
  const pool = loadEeveePool();
  if (pool.length < POKEMON_PACK_SIZE) return null;

  const common = pool.filter(c => c.rarity === 'Common');
  const uncommon = pool.filter(c => c.rarity === 'Uncommon');
  const rare = pool.filter(c => c.rarity && c.rarity.includes('Rare'));
  const any = pool;

  let picked: any[];
  if (common.length >= 4 && uncommon.length >= 3 && rare.length >= 2) {
    picked = [...pickRandom(common, 4), ...pickRandom(uncommon, 3), ...pickRandom(rare, 2)];
  } else {
    picked = pickRandom(any, POKEMON_PACK_SIZE);
  }

  const pack = picked.map(card => ({
    name: card.name,
    number: card.number,
    setCode: card._setCode,
    rarity: card.rarity || 'Common',
    imageUrl: card.images?.large || `https://images.pokemontcg.io/${card._setCode}/${card.number}.png`,
  }));

  console.log(`[Pokemon] ${username} opened an Eevee booster pack`);
  await addCardsToUser(username, pack);
  const eventId = broadcastPack(pack, 'Eevee Booster', username, tenantId);
  return { pack, setName: 'Eevee Booster', username, eventId };
}
