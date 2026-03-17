import { sendChatMessage } from './twitch';
import { getUserCards, removeCardFromUser, addCardsToUser } from './pokemon-collection';
import { getUserCollection, saveUserCollection } from './pokemon-storage-discord';

interface TradeSession {
  initiator: string;
  target: string;
  initiatorCard?: { index: number; name: string; number: string; setCode: string; imageUrl?: string };
  targetCard?: { index: number; name: string; number: string; setCode: string; imageUrl?: string };
  initiatorAccepted: boolean;
  targetAccepted: boolean;
  expiresAt: number;
}

const activeTrades = new Map<string, TradeSession>();
const TRADE_TIMEOUT = 120000;

function getTradeKey(user1: string, user2: string): string {
  return [user1, user2].sort().join(':');
}

export async function initiateTrade(initiator: string, target: string): Promise<void> {
  const key = getTradeKey(initiator, target);

  if (activeTrades.has(key)) {
    await sendChatMessage(`@${initiator}, you already have an active trade with @${target}!`, 'broadcaster');
    return;
  }

  activeTrades.set(key, {
    initiator,
    target,
    initiatorAccepted: false,
    targetAccepted: false,
    expiresAt: Date.now() + TRADE_TIMEOUT
  });

  await sendChatMessage(
    `@${initiator} wants to trade with @${target}! Both use !offer <name> <number> or !offer <set>-<number> to select a card.`,
    'broadcaster'
  );
}

export async function offerCard(username: string, cardIdentifier: string): Promise<void> {
  const trade = Array.from(activeTrades.entries()).find(([_, s]) =>
    s.initiator === username || s.target === username
  );

  if (!trade) {
    await sendChatMessage(`@${username}, you don't have an active trade!`, 'broadcaster');
    return;
  }

  const [key, session] = trade;
  const userCards = await getUserCards(username);

  if (userCards.length === 0) {
    await sendChatMessage(`@${username}, you don't have any cards!`, 'broadcaster');
    return;
  }

  const parts = cardIdentifier.trim().split(/\s+/);
  let matches: { card: any; index: number }[] = [];

  if (cardIdentifier.includes('-')) {
    const [setCode, number] = cardIdentifier.split('-');
    matches = userCards
      .map((c, i) => ({ card: c, index: i }))
      .filter(({ card }) => card.setCode.toLowerCase() === setCode.toLowerCase() && card.number === number);
  } else if (parts.length >= 2) {
    const number = parts[parts.length - 1];
    const nameOrSet = parts.slice(0, -1).join(' ').toLowerCase();
    matches = userCards
      .map((c, i) => ({ card: c, index: i }))
      .filter(({ card }) =>
        card.number === number &&
        (card.name.toLowerCase().includes(nameOrSet) || card.setCode.toLowerCase() === nameOrSet)
      );
  } else {
    await sendChatMessage(`@${username}, use: !offer <name> <number> or !offer <set>-<number>`, 'broadcaster');
    return;
  }

  if (matches.length === 0) {
    await sendChatMessage(`@${username}, card not found in your collection!`, 'broadcaster');
    return;
  }

  if (matches.length > 1) {
    const list = matches.slice(0, 5).map(m => `${m.card.name} (${m.card.setCode}-${m.card.number})`).join(', ');
    await sendChatMessage(`@${username}, multiple matches: ${list}. Be more specific!`, 'broadcaster');
    return;
  }

  const { card, index } = matches[0];
  const offered = { index, name: card.name, number: card.number, setCode: card.setCode, imageUrl: card.imageUrl };

  if (session.initiator === username) {
    session.initiatorCard = offered;
  } else {
    session.targetCard = offered;
  }

  await sendChatMessage(`@${username} offered ${card.name} (${card.setCode}-${card.number})!`, 'broadcaster');

  if (session.initiatorCard && session.targetCard) {
    await sendChatMessage(
      `Trade ready! @${session.initiator} (${session.initiatorCard.name}) ↔ @${session.target} (${session.targetCard.name}). Both type !accept to confirm!`,
      'broadcaster'
    );

    const broadcast = (global as any).broadcast;
    if (typeof broadcast === 'function') {
      broadcast({
        type: 'pokemon-trade-preview',
        userA: session.initiator,
        userB: session.target,
        cardA: session.initiatorCard,
        cardB: session.targetCard
      });
    }
  }
}

export async function acceptTrade(username: string): Promise<void> {
  const trade = Array.from(activeTrades.entries()).find(([_, s]) =>
    s.initiator === username || s.target === username
  );

  if (!trade) {
    await sendChatMessage(`@${username}, you don't have an active trade!`, 'broadcaster');
    return;
  }

  const [key, session] = trade;

  if (!session.initiatorCard || !session.targetCard) {
    await sendChatMessage(`@${username}, both users must offer cards first!`, 'broadcaster');
    return;
  }

  if (session.initiator === username) session.initiatorAccepted = true;
  else session.targetAccepted = true;

  await sendChatMessage(`@${username} accepted the trade!`, 'broadcaster');

  if (session.initiatorAccepted && session.targetAccepted) {
    await executeTrade(session);
    activeTrades.delete(key);
  }
}

export async function cancelTrade(username: string): Promise<void> {
  const trade = Array.from(activeTrades.entries()).find(([_, s]) =>
    s.initiator === username || s.target === username
  );

  if (!trade) {
    await sendChatMessage(`@${username}, you don't have an active trade!`, 'broadcaster');
    return;
  }

  const [key, session] = trade;
  activeTrades.delete(key);
  await sendChatMessage(`Trade between @${session.initiator} and @${session.target} cancelled!`, 'broadcaster');
}

async function executeTrade(session: TradeSession): Promise<void> {
  const cardA = session.initiatorCard!;
  const cardB = session.targetCard!;

  // Load both collections
  const collA = await getUserCollection(session.initiator);
  const collB = await getUserCollection(session.target);

  // Verify cards still exist at expected indices
  const realA = collA.cards[cardA.index];
  const realB = collB.cards[cardB.index];

  if (!realA || realA.setCode !== cardA.setCode || realA.number !== cardA.number) {
    await sendChatMessage(`Trade failed — ${session.initiator}'s card is no longer available!`, 'broadcaster');
    return;
  }
  if (!realB || realB.setCode !== cardB.setCode || realB.number !== cardB.number) {
    await sendChatMessage(`Trade failed — ${session.target}'s card is no longer available!`, 'broadcaster');
    return;
  }

  // Swap: remove from each, add to other
  const removedA = collA.cards.splice(cardA.index, 1)[0];
  // Adjust index if B is in same collection (shouldn't be, but safety)
  const removedB = collB.cards.splice(cardB.index, 1)[0];

  collA.cards.push(removedB);
  collB.cards.push(removedA);

  await saveUserCollection(session.initiator, collA);
  await saveUserCollection(session.target, collB);

  const broadcast = (global as any).broadcast;
  if (typeof broadcast === 'function') {
    broadcast({
      type: 'pokemon-trade-execute',
      userA: session.initiator,
      userB: session.target,
      cardA: { ...removedA },
      cardB: { ...removedB }
    });
  }

  await sendChatMessage(
    `✅ Trade complete! @${session.initiator} got ${removedB.name}, @${session.target} got ${removedA.name}!`,
    'broadcaster'
  );
}

// Cleanup expired trades
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of activeTrades.entries()) {
    if (session.expiresAt < now) {
      activeTrades.delete(key);
      sendChatMessage(
        `Trade between @${session.initiator} and @${session.target} expired!`,
        'broadcaster'
      ).catch(() => {});
    }
  }
}, 30000);
