import { getUserCollection as getSharedCollection, saveUserCollection, normalizePokemonUsername } from './pokemon-storage-discord';

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

export async function getAvailableSets(): Promise<string[]> {
  return ['base-set', 'jungle', 'fossil'];
}

export async function getUserCollection(username: string): Promise<UserCollection> {
  const key = normalizePokemonUsername(username);
  const shared = await getSharedCollection(key);
  return {
    username: key,
    cards: shared.cards.map(card => ({
      id: `${card.setCode}-${card.number}-${card.openedAt || ''}-${card.name}`,
      name: card.name,
      set: card.setCode,
      number: card.number,
      rarity: normalizeLegacyRarity(card.rarity),
      imagePath: card.imageUrl || `https://images.pokemontcg.io/${card.setCode}/${card.number}.png`,
    })),
    packs: shared.pendingPacks || 0,
    pendingSetChoice: (shared.pendingPacks || 0) > 0,
  };
}

export async function addPacksToUser(username: string, count: number): Promise<void> {
  const shared = await getSharedCollection(username);
  shared.pendingPacks = (shared.pendingPacks || 0) + count;
  await saveUserCollection(username, shared);
}

export async function openBoosterPack(username: string, setName?: string): Promise<PokemonCard[] | null> {
  const shared = await getSharedCollection(username);
  if ((shared.pendingPacks || 0) <= 0) return null;

  const cards: PokemonCard[] = [];
  
  // Slots 1-3: Common/Uncommon with chance for rare
  for (let i = 0; i < 3; i++) {
    const rarity = Math.random() < 0.15 ? 'rare' : (Math.random() < 0.6 ? 'common' : 'uncommon');
    cards.push(createCard(rarity, setName));
  }
  
  // Slot 4: Guaranteed rare
  const rareRoll = Math.random();
  let slot4Rarity: PokemonCard['rarity'];
  if (rareRoll < 0.01) slot4Rarity = 'secret';
  else if (rareRoll < 0.05) slot4Rarity = 'ultra';
  else if (rareRoll < 0.20) slot4Rarity = 'holo';
  else slot4Rarity = 'rare';
  cards.push(createCard(slot4Rarity, setName));
  
  // Slots 5-7: Energy/Trainer cards
  for (let i = 0; i < 3; i++) {
    const rarity = Math.random() < 0.7 ? 'common' : 'uncommon';
    const card = createCard(rarity, setName, true);
    cards.push(card);
  }

  shared.pendingPacks = Math.max((shared.pendingPacks || 0) - 1, 0);
  shared.cards.push(
    ...cards.map(card => ({
      name: card.name,
      number: card.number,
      setCode: card.set,
      rarity: denormalizeLegacyRarity(card.rarity),
      imageUrl: card.imagePath,
      openedAt: new Date().toISOString(),
    }))
  );
  await saveUserCollection(username, shared);
  
  return cards;
}

function createCard(rarity: PokemonCard['rarity'], setName?: string, preferTrainer = false): PokemonCard {
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
  const collectionA = await getUserCollection(userA);
  const collectionB = await getUserCollection(userB);
  
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
  
  const sharedA = await getSharedCollection(userA);
  const sharedB = await getSharedCollection(userB);

  sharedA.cards = collectionA.cards.map(card => ({
    name: card.name,
    number: card.number,
    setCode: card.set,
    rarity: denormalizeLegacyRarity(card.rarity),
    imageUrl: card.imagePath,
  }));
  sharedB.cards = collectionB.cards.map(card => ({
    name: card.name,
    number: card.number,
    setCode: card.set,
    rarity: denormalizeLegacyRarity(card.rarity),
    imageUrl: card.imagePath,
  }));

  await saveUserCollection(userA, sharedA);
  await saveUserCollection(userB, sharedB);
  
  return { success: true, cardA, cardB };
}

function normalizeLegacyRarity(rarity: string): PokemonCard['rarity'] {
  const value = rarity.toLowerCase();
  if (value.includes('secret')) return 'secret';
  if (value.includes('ultra')) return 'ultra';
  if (value.includes('holo')) return 'holo';
  if (value.includes('rare')) return 'rare';
  if (value.includes('uncommon')) return 'uncommon';
  return 'common';
}

function denormalizeLegacyRarity(rarity: PokemonCard['rarity']): string {
  switch (rarity) {
    case 'secret':
      return 'Rare Secret';
    case 'ultra':
      return 'Rare Ultra';
    case 'holo':
      return 'Rare Holo';
    case 'rare':
      return 'Rare';
    case 'uncommon':
      return 'Uncommon';
    default:
      return 'Common';
  }
}
