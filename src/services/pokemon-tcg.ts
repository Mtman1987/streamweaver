import { promises as fs } from 'fs';
import { join } from 'path';

export interface PokemonCard {
  id: string;
  name: string;
  set: string;
  number: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'holo' | 'ultra' | 'secret';
  imagePath: string;
}

export interface UserCollection {
  username: string;
  cards: PokemonCard[];
  packs: number;
  pendingSetChoice?: boolean;
}

const COLLECTIONS_FILE = join(process.cwd(), 'src', 'data', 'pokemon-collections.json');
const CARDS_DIR = join(process.cwd(), 'public', 'cards');
const SORTED_CARDS_DIR = CARDS_DIR;

async function loadCollections(): Promise<Record<string, UserCollection>> {
  try {
    const data = await fs.readFile(COLLECTIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveCollections(collections: Record<string, UserCollection>): Promise<void> {
  const dir = join(process.cwd(), 'data');
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {}
  await fs.writeFile(COLLECTIONS_FILE, JSON.stringify(collections, null, 2));
}

export async function getAvailableSets(): Promise<string[]> {
  try {
    const entries = await fs.readdir(CARDS_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort();
  } catch {
    return ['base-set', 'jungle', 'fossil']; // Default sets if no cards directory
  }
}

export async function getUserCollection(username: string): Promise<UserCollection> {
  const collections = await loadCollections();
  return collections[username] || { username, cards: [], packs: 0, pendingSetChoice: false };
}

export async function addPacksToUser(username: string, count: number): Promise<void> {
  const collections = await loadCollections();
  const user = collections[username] || { username, cards: [], packs: 0, pendingSetChoice: false };
  user.packs += count;
  user.pendingSetChoice = true;
  collections[username] = user;
  await saveCollections(collections);
}

export async function openBoosterPack(username: string, setName?: string): Promise<PokemonCard[] | null> {
  const collections = await loadCollections();
  const user = collections[username];
  
  if (!user || user.packs <= 0) return null;
  
  // If no set specified, use random from all cards
  const setDir = setName ? join(SORTED_CARDS_DIR, setName) : null;
  
  const cards: PokemonCard[] = [];
  
  // Slots 1-3: Common/Uncommon with chance for rare
  for (let i = 0; i < 3; i++) {
    const rarity = Math.random() < 0.15 ? 'rare' : (Math.random() < 0.6 ? 'common' : 'uncommon');
    cards.push(await createCard(setDir, rarity, setName));
  }
  
  // Slot 4: Guaranteed rare
  const rareRoll = Math.random();
  let slot4Rarity: PokemonCard['rarity'];
  if (rareRoll < 0.01) slot4Rarity = 'secret';
  else if (rareRoll < 0.05) slot4Rarity = 'ultra';
  else if (rareRoll < 0.20) slot4Rarity = 'holo';
  else slot4Rarity = 'rare';
  cards.push(await createCard(setDir, slot4Rarity, setName));
  
  // Slots 5-7: Energy/Trainer cards
  for (let i = 0; i < 3; i++) {
    const rarity = Math.random() < 0.7 ? 'common' : 'uncommon';
    const card = await createCard(setDir, rarity, setName, true);
    cards.push(card);
  }
  
  user.packs--;
  user.pendingSetChoice = false;
  user.cards.push(...cards);
  collections[username] = user;
  await saveCollections(collections);
  
  return cards;
}

async function createCard(setDir: string | null, rarity: PokemonCard['rarity'], setName?: string, preferTrainer = false): Promise<PokemonCard> {
  // Create a mock card since we don't have actual card assets
  const cardNames = ['Pikachu', 'Charizard', 'Blastoise', 'Venusaur', 'Mewtwo', 'Mew', 'Alakazam', 'Gengar', 'Dragonite', 'Snorlax'];
  const trainerNames = ['Professor Oak', 'Bill', 'Energy Removal', 'Potion', 'Switch'];
  
  const isTrainer = preferTrainer && Math.random() < 0.7;
  const name = isTrainer ? trainerNames[Math.floor(Math.random() * trainerNames.length)] : cardNames[Math.floor(Math.random() * cardNames.length)];
  const number = Math.floor(Math.random() * 150) + 1;
  
  return {
    id: `${name}_${number}_${Date.now()}_${Math.random()}`,
    name,
    set: setName || 'base-set',
    number: number.toString(),
    rarity,
    imagePath: `https://images.pokemontcg.io/base1/${number}.png` // Use Pokemon TCG API images as fallback
  };
}

export async function tradeCards(userA: string, userB: string, cardIdA: string, cardIdB: string): Promise<{ success: boolean; cardA: PokemonCard; cardB: PokemonCard }> {
  const collections = await loadCollections();
  const collectionA = collections[userA];
  const collectionB = collections[userB];
  
  if (!collectionA || !collectionB) {
    throw new Error('One or both users not found');
  }
  
  const cardAIndex = collectionA.cards.findIndex(c => c.id === cardIdA);
  const cardBIndex = collectionB.cards.findIndex(c => c.id === cardIdB);
  
  if (cardAIndex === -1 || cardBIndex === -1) {
    throw new Error('One or both cards not found');
  }
  
  const cardA = collectionA.cards[cardAIndex];
  const cardB = collectionB.cards[cardBIndex];
  
  // Swap cards
  collectionA.cards.splice(cardAIndex, 1, cardB);
  collectionB.cards.splice(cardBIndex, 1, cardA);
  
  collections[userA] = collectionA;
  collections[userB] = collectionB;
  await saveCollections(collections);
  
  return { success: true, cardA, cardB };
}
