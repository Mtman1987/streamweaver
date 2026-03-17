import { getUserCollection, saveUserCollection } from './pokemon-storage-discord';

type Card = {
  name: string;
  number: string;
  setCode: string;
  rarity: string;
  imageUrl?: string;
  seasonId?: string;
  openedAt?: string;
};

export async function addCardsToUser(username: string, cards: Card[]): Promise<void> {
  console.log(`[Pokemon Collection] Adding ${cards.length} cards to ${username}`);
  const collection = await getUserCollection(username);
  const now = new Date().toISOString();
  const seasonId = getCurrentSeasonId();
  const stamped = cards.map(c => ({ ...c, seasonId, openedAt: now }));
  collection.cards.push(...stamped);
  collection.packsOpened = (collection.packsOpened || 0) + 1;
  await saveUserCollection(username, collection);
  console.log(`[Pokemon Collection] Saved: ${collection.cards.length} cards, ${collection.packsOpened} packs opened`);
}

function getCurrentSeasonId(): string {
  try {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(process.cwd(), 'data', 'seasons.json');
    if (fs.existsSync(file)) {
      const seasons = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const active = seasons.find((s: any) => s.active);
      if (active) return active.id;
    }
  } catch {}
  return 'default';
}

export async function getUserCards(username: string): Promise<Card[]> {
  const collection = await getUserCollection(username);
  return collection.cards;
}

export async function removeCardFromUser(username: string, cardIndex: number): Promise<Card | null> {
  const collection = await getUserCollection(username);
  if (!collection.cards[cardIndex]) return null;
  const [card] = collection.cards.splice(cardIndex, 1);
  await saveUserCollection(username, collection);
  return card;
}
