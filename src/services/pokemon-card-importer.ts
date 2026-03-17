import { promises as fs } from 'fs';
import { join } from 'path';

type ImportedPokemonCard = {
  id: string;
  name: string;
  set: string;
  number: string;
  rarity: string;
  imagePath: string;
};

const CARDS_BASE_PATH = join(process.cwd(), 'public', 'pokemon-cards');
const OUTPUT_PATH = join(process.cwd(), 'data', 'pokemon-cards', 'imported-index.json');

async function persistImportedCards(cards: ImportedPokemonCard[]): Promise<void> {
  await fs.mkdir(join(process.cwd(), 'data', 'pokemon-cards'), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(cards, null, 2));
}

/**
 * Import cards from new image library structure:
 * /pokemon-cards/
 *   ├── base-set/
 *   │   ├── common/
 *   │   ├── uncommon/
 *   │   ├── rare/
 *   │   ├── holo/
 *   │   └── energy/
 *   ├── jungle/
 *   └── fossil/
 */
export async function importCardsFromImageLibrary(): Promise<void> {
  try {
    const setFolders = await fs.readdir(CARDS_BASE_PATH, { withFileTypes: true });
    const importedCards: ImportedPokemonCard[] = [];
    
    for (const setFolder of setFolders) {
      if (!setFolder.isDirectory()) continue;
      
      const setPath = join(CARDS_BASE_PATH, setFolder.name);
      const rarityFolders = await fs.readdir(setPath, { withFileTypes: true });
      
      for (const rarityFolder of rarityFolders) {
        if (!rarityFolder.isDirectory()) continue;
        
        const rarity = rarityFolder.name;
        const rarityPath = join(setPath, rarityFolder.name);
        const cardFiles = await fs.readdir(rarityPath);
        
        for (const cardFile of cardFiles) {
          if (!cardFile.endsWith('.jpg') && !cardFile.endsWith('.png')) continue;
          
          // Parse filename: card-name_number.jpg
          const match = cardFile.match(/^(.+)_(\d+)\.(jpg|png)$/);
          if (!match) continue;

          const [, cardName, number] = match;
          const cleanName = cardName.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

          importedCards.push({
            id: `${setFolder.name}-${number.padStart(3, '0')}`,
            name: cleanName,
            set: setFolder.name,
            number,
            rarity,
            imagePath: join('/pokemon-cards', setFolder.name, rarityFolder.name, cardFile),
          });
        }
      }

    }

    await persistImportedCards(importedCards);
    console.log(`[Pokemon Import] Added ${importedCards.length} cards to ${OUTPUT_PATH}`);

    console.log('[Pokemon Import] Card import completed');
  } catch (error) {
    console.error('[Pokemon Import] Failed to import cards:', error);
  }
}

/**
 * Import from CSV rarity list:
 * Format: "Card Name","Set","Number","Rarity"
 */
export async function importFromCSV(csvPath: string): Promise<void> {
  try {
    const csvContent = await fs.readFile(csvPath, 'utf-8');
    const lines = csvContent.split('\n').slice(1);

    const cards: ImportedPokemonCard[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      const [name, set, number, rarity] = line.split(',').map((value) => value.replace(/"/g, '').trim());

      if (name && set && number && rarity) {
        cards.push({
          id: `${set}-${number.padStart(3, '0')}`,
          name,
          set,
          number,
          rarity: rarity.toLowerCase(),
          imagePath: `/pokemon-cards/${set}/${rarity.toLowerCase()}/${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}_${number}.jpg`,
        });
      }
    }

    await persistImportedCards(cards);
    console.log(`[Pokemon Import] Imported ${cards.length} cards from CSV`);
  } catch (error) {
    console.error('[Pokemon Import] Failed to import from CSV:', error);
  }
}