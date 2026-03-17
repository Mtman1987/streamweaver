import { openBoosterPack, loadSetData, type PokemonCard } from '../../pokemon-booster-packs';
import { sendChatMessage } from '../../twitch';
import { getPoints, addPoints } from '../../points';

export async function handlePokemonPackOpen(context: any, params: any): Promise<void> {
  const { username, args } = context;
  const { setNumber = 1, cost = 1500 } = params;
  
  const setMap: Record<number, string> = {
    1: 'base1', 2: 'base2', 3: 'base3', 
    4: 'base4', 5: 'gym2', 6: 'gym1'
  };
  
  const setCode = setMap[setNumber] || 'base1';
  
  try {
    const userPoints = await getPoints(username);
    
    if (userPoints.points < cost) {
      await sendChatMessage(`@${username} needs ${cost} points (has ${userPoints.points})`, 'bot');
      return;
    }
    
    await addPoints(username, -cost);
    const result = await openBoosterPack(setCode, username);
    
    if (result && typeof (global as any).broadcast === 'function') {
      (global as any).broadcast({
        type: 'pokemon-pack-opened',
        payload: result
      });
      
      // Show all cards with names and rarities
      const cardList = result.pack.map((card: PokemonCard) => `${card.name} (${card.rarity})`).join(', ');
      await sendChatMessage(`@${username} opened ${result.setName}: ${cardList}`, 'bot');
    }
  } catch (error) {
    console.error('[Pokemon] Pack open error:', error);
  }
}

export async function handlePokemonCollectionShow(context: any, params: any): Promise<void> {
  const { username } = context;
  
  try {
    const { getUser } = require('../user-stats');
    const user = await getUser(username);
    
    if (typeof (global as any).broadcast === 'function') {
      (global as any).broadcast({
        type: 'pokemon-collection-show',
        username,
        cards: user.cardCollection || []
      });
    }
    
    await sendChatMessage(`@${username}: ${user.totalCards || 0} cards (${user.rareCards || 0} rare)`, 'bot');
  } catch (error) {
    console.error('[Pokemon] Collection show error:', error);
  }
}

export async function handlePokemonCardsList(context: any, params: any): Promise<void> {
  // Removed - redundant with !collection
}

export async function handlePokemonShowCard(context: any, params: any): Promise<void> {
  const { username, rawInput } = context;
  const { cardIdentifier } = params;
  
  const searchTerm = cardIdentifier || rawInput;
  if (!searchTerm) {
    await sendChatMessage(`@${username}, usage: !show cardname`, 'bot');
    return;
  }
  
  try {
    // Search all cards for the name
    const sets = ['base1', 'base2', 'base3', 'gym1', 'gym2'];
    let foundCard = null;
    
    for (const setCode of sets) {
      const cards = await loadSetData(setCode);
      foundCard = cards.find((card: PokemonCard) => 
        card.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      if (foundCard) break;
    }
    
    if (!foundCard) {
      await sendChatMessage(`@${username}, card "${searchTerm}" not found`, 'bot');
      return;
    }
    
    // Check if user owns this card (and how many)
    const { getUser } = require('../user-stats');
    const user = await getUser(username);
    const ownedCards = user.cardCollection?.filter((id: string) => id === foundCard.id) || [];
    const ownedCount = ownedCards.length;
    
    // Show large image on overlay
    if (typeof (global as any).broadcast === 'function') {
      (global as any).broadcast({
        type: 'pokemon-show-card',
        payload: { username, card: foundCard }
      });
    }
    
    // Show card info in chat
    const info = [];
    if (foundCard.hp) info.push(`${foundCard.hp} HP`);
    if (foundCard.types) info.push(foundCard.types.join('/'));
    if (foundCard.rarity) info.push(foundCard.rarity);
    info.push(`#${foundCard.number}`);
    
    const ownership = ownedCount > 0 ? `Owned: ${ownedCount}` : 'Not owned';
    
    await sendChatMessage(`@${username} ${foundCard.name}: ${info.join(' | ')} | ${ownership}`, 'bot');
    
  } catch (error) {
    console.error('[Pokemon] Show card error:', error);
  }
}

export async function handlePokemonTradeInitiate(context: any, params: any): Promise<void> {
  const { username, rawInput } = context;
  const { targetUser } = params;
  
  const target = (targetUser || rawInput)?.replace('@', '');
  if (!target) {
    await sendChatMessage(`@${username}, usage: !trade @username`, 'bot');
    return;
  }
  
  try {
    const { initiateTrade } = require('../pokemon-trade-manager');
    await initiateTrade(username, target);
  } catch (error) {
    console.error('[Pokemon] Trade initiate error:', error);
  }
}

export async function handleCommandsListShow(context: any, params: any): Promise<void> {
  const { username } = context;
  
  try {
    const { getAllCommands } = require('../../lib/commands-store');
    const commands = await getAllCommands();
    const activeCommands = commands.filter((c: any) => c.enabled).map((c: any) => c.command).sort();
    
    if (activeCommands.length === 0) {
      await sendChatMessage(`@${username}, no commands active`, 'bot');
    } else {
      // Show only count to reduce spam
      await sendChatMessage(`@${username}: ${activeCommands.length} commands available`, 'bot');
    }
  } catch (error) {
    console.error('[Commands] List show error:', error);
  }
}