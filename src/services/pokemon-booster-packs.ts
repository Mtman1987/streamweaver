import { readJsonFile, writeJsonFile } from './storage';
import { promises as fs } from 'fs';
import { join } from 'path';

export interface PokemonCard {
  id: string;
  name: string;
  supertype: string;
  subtypes: string[];
  level?: string;
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  abilities?: any[];
  attacks?: any[];
  weaknesses?: any[];
  retreatCost?: string[];
  convertedRetreatCost?: number;
  number: string;
  artist?: string;
  rarity: string;
  flavorText?: string;
  nationalPokedexNumbers?: number[];
  legalities?: any;
  images: {
    small: string;
    large: string;
  };
}

export interface SetData {
  cards: PokemonCard[];
}

const SETS_DIR = join(process.cwd(), 'data', 'pokemon-cards');
const RARITY_MAP: Record<string, string> = {
  'Common': 'common',
  'Uncommon': 'uncommon', 
  'Rare': 'rare',
  'Rare Holo': 'holo',
  'Rare Holo EX': 'holo',
  'Rare Holo GX': 'holo',
  'Rare Holo V': 'holo',
  'Rare Holo VMAX': 'holo',
  'Rare Ultra': 'ultra',
  'Rare Secret': 'secret',
  'Rare Rainbow': 'secret',
  'Rare Shiny': 'secret'
};

let loadedSets: Record<string, PokemonCard[]> = {};

export async function loadSetData(setCode: string): Promise<PokemonCard[]> {
  if (loadedSets[setCode]) return loadedSets[setCode];
  
  try {
    const setPath = join(SETS_DIR, `${setCode}.json`);
    const setData = JSON.parse(await fs.readFile(setPath, 'utf-8')) as PokemonCard[];
    loadedSets[setCode] = setData;
    console.log(`[Pokemon] Loaded ${setData.length} cards from ${setCode}`);
    return setData;
  } catch (error) {
    console.error(`[Pokemon] Failed to load set ${setCode}:`, error);
    return [];
  }
}

export function normalizeRarity(rarity: string): string {
  return RARITY_MAP[rarity] || 'common';
}

export function getCardsByRarity(cards: PokemonCard[], targetRarity: string): PokemonCard[] {
  return cards.filter(card => {
    const normalized = normalizeRarity(card.rarity);
    return normalized === targetRarity;
  });
}

export function getEnergyCards(cards: PokemonCard[]): PokemonCard[] {
  return cards.filter(card => 
    card.supertype === 'Energy' || 
    card.name.toLowerCase().includes('energy')
  );
}

export function getRandomCard(cards: PokemonCard[]): PokemonCard | null {
  if (cards.length === 0) return null;
  return cards[Math.floor(Math.random() * cards.length)];
}

export async function openBoosterPack(setCode: string, username: string): Promise<{ pack: PokemonCard[]; setName: string } | null> {
  const allCards = await loadSetData(setCode);
  if (allCards.length === 0) return null;

  const pack: PokemonCard[] = [];

  // 4 Common cards
  const commonCards = getCardsByRarity(allCards, 'common');
  for (let i = 0; i < 4; i++) {
    const card = getRandomCard(commonCards);
    if (card) pack.push(card);
  }

  // 3 Uncommon cards
  const uncommonCards = getCardsByRarity(allCards, 'uncommon');
  for (let i = 0; i < 3; i++) {
    const card = getRandomCard(uncommonCards);
    if (card) pack.push(card);
  }

  // 1 Rare or higher card
  const rareRoll = Math.random();
  let targetRarity: string;
  
  if (rareRoll < 0.001) targetRarity = 'secret';     // 0.1% Secret Rare
  else if (rareRoll < 0.015) targetRarity = 'ultra';  // 1.4% Ultra Rare
  else if (rareRoll < 0.10) targetRarity = 'holo';    // 8.5% Holo Rare
  else targetRarity = 'rare';                         // 90% Regular Rare

  const rareCards = getCardsByRarity(allCards, targetRarity);
  const rareCard = getRandomCard(rareCards);
  if (rareCard) pack.push(rareCard);

  // 1 Energy card
  const energyCards = getEnergyCards(allCards);
  const energyCard = getRandomCard(energyCards);
  if (energyCard) pack.push(energyCard);

  // Reverse holo chance (33%)
  if (Math.random() < 0.33 && pack.length >= 7) {
    const replaceIndex = Math.floor(Math.random() * 7);
    const originalCard = pack[replaceIndex];
    
    pack[replaceIndex] = {
      ...originalCard,
      id: `${originalCard.id}_reverse_holo`,
      rarity: 'Rare Holo'
    };
  }

  console.log(`[Pokemon] ${username} opened ${setCode} pack: ${pack.length} cards`);
  
  return {
    pack,
    setName: setCode.toUpperCase()
  };
}