import { sendChatMessage } from './twitch';
import { getUserCards, removeCardFromUser, addCardsToUser } from './pokemon-collection';
import { getUserCollection, saveUserCollection } from './pokemon-storage-discord';

interface TradeSession {
  initiator: string;
  target: string;
  tenantId: string;
  initiatorCard?: { index: number; name: string; number: string; setCode: string; imageUrl?: string };
  targetCard?: { index: number; name: string; number: string; setCode: string; imageUrl?: string };
  initiatorAccepted: boolean;
  targetAccepted: boolean;
  expiresAt: number;
}

const activeTrades = new Map<string, Map<string, TradeSession>>();
const TRADE_TIMEOUT = 120000;

function normalizeTenantId(tenantId?: string): string | undefined {
  if (tenantId?.startsWith('__kick_silent__:')) return tenantId.slice('__kick_silent__:'.length);
  return tenantId;
}

function getTradeKey(user1: string, user2: string, tenantId: string): string {
  return `${tenantId}:${[user1, user2].sort().join(':')}`;
}

export async function initiateTrade(initiator: string, target: string, tenantId?: string): Promise<void> {
  const tid = tenantId || 'global';
  const key = getTradeKey(initiator, target, tid);
  const tenantTrades = activeTrades.get(tid) || new Map();
  activeTrades.set(tid, tenantTrades);

  if (tenantTrades.has(key)) {
    await sendChatMessage(`@${initiator}, you already have an active trade with @${target}!`, 'broadcaster', undefined, tenantId);
    return;
  }

  tenantTrades.set(key, {
    initiator,
    target,
    tenantId: tid,
    initiatorAccepted: false,
    targetAccepted: false,
    expiresAt: Date.now() + TRADE_TIMEOUT
  });

  await sendChatMessage(
    `@${initiator} wants to trade with @${target}! Both use !offer <name> <number> or !offer <set>-<number> to select a card.`,
    'broadcaster',
    undefined,
    tenantId
  );
}

export async function offerCard(username: string, cardIdentifier: string, tenantId?: string): Promise<void> {
  const tid = tenantId || 'global';
  const tenantTrades = activeTrades.get(tid);
  if (!tenantTrades) {
    await sendChatMessage(`@${username}, you don't have an active trade!`, 'broadcaster', undefined, tenantId);
    return;
  }

  const trade = Array.from(tenantTrades.entries()).find(([_, s]) =>
    s.initiator === username || s.target === username
  );

  if (!trade) {
    await sendChatMessage(`@${username}, you don't have an active trade!`, 'broadcaster', undefined, tenantId);
    return;
  }

  const [key, session] = trade;
  const userCards = await getUserCards(username);

  if (userCards.length === 0) {
    await sendChatMessage(`@${username}, you don't have any cards!`, 'broadcaster', undefined, tenantId);
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
    await sendChatMessage(`@${username}, use: !offer <name> <number> or !offer <set>-<number>`, 'broadcaster', undefined, tenantId);
    return;
  }

  if (matches.length === 0) {
    await sendChatMessage(`@${username}, card not found in your collection!`, 'broadcaster', undefined, tenantId);
    return;
  }

  if (matches.length > 1) {
    const list = matches.slice(0, 5).map(m => `${m.card.name} (${m.card.setCode}-${m.card.number})`).join(', ');
    await sendChatMessage(`@${username}, multiple matches: ${list}. Be more specific!`, 'broadcaster', undefined, tenantId);
    return;
  }

  const { card, index } = matches[0];
  const offered = { index, name: card.name, number: card.number, setCode: card.setCode, imageUrl: card.imageUrl };

  if (session.initiator === username) {
    session.initiatorCard = offered;
  } else {
    session.targetCard = offered;
  }

  await sendChatMessage(`@${username} offered ${card.name} (${card.setCode}-${card.number})!`, 'broadcaster', undefined, tenantId);

  if (session.initiatorCard && session.targetCard) {
    await sendChatMessage(
      `Trade ready! @${session.initiator} (${session.initiatorCard.name}) ↔ @${session.target} (${session.targetCard.name}). Both type !accept to confirm!`,
      'broadcaster',
      undefined,
      tenantId
    );

    const broadcast = (global as any).broadcast;
    if (typeof broadcast === 'function') {
      broadcast({
        type: 'pokemon-trade-preview',
        userA: session.initiator,
        userB: session.target,
        cardA: session.initiatorCard,
        cardB: session.targetCard
      }, normalizeTenantId(tid));
    }
  }
}

export async function acceptTrade(username: string, tenantId?: string): Promise<void> {
  const tid = tenantId || 'global';
  const tenantTrades = activeTrades.get(tid);
  if (!tenantTrades) {
    await sendChatMessage(`@${username}, you don't have an active trade!`, 'broadcaster', undefined, tenantId);
    return;
  }

  const trade = Array.from(tenantTrades.entries()).find(([_, s]) =>
    s.initiator === username || s.target === username
  );

  if (!trade) {
    await sendChatMessage(`@${username}, you don't have an active trade!`, 'broadcaster', undefined, tenantId);
    return;
  }

  const [key, session] = trade;

  if (!session.initiatorCard || !session.targetCard) {
    await sendChatMessage(`@${username}, both users must offer cards first!`, 'broadcaster', undefined, tenantId);
    return;
  }

  if (session.initiator === username) session.initiatorAccepted = true;
  else session.targetAccepted = true;

  await sendChatMessage(`@${username} accepted the trade!`, 'broadcaster', undefined, tenantId);

  if (session.initiatorAccepted && session.targetAccepted) {
    await executeTrade(session);
    tenantTrades.delete(key);
  }
}

export async function cancelTrade(username: string, tenantId?: string): Promise<void> {
  const tid = tenantId || 'global';
  const tenantTrades = activeTrades.get(tid);
  if (!tenantTrades) {
    await sendChatMessage(`@${username}, you don't have an active trade!`, 'broadcaster', undefined, tenantId);
    return;
  }

  const trade = Array.from(tenantTrades.entries()).find(([_, s]) =>
    s.initiator === username || s.target === username
  );

  if (!trade) {
    await sendChatMessage(`@${username}, you don't have an active trade!`, 'broadcaster', undefined, tenantId);
    return;
  }

  const [key, session] = trade;
  tenantTrades.delete(key);
  await sendChatMessage(`Trade between @${session.initiator} and @${session.target} cancelled!`, 'broadcaster', undefined, tenantId);
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
    await sendChatMessage(`Trade failed — ${session.initiator}'s card is no longer available!`, 'broadcaster', undefined, session.tenantId);
    return;
  }
  if (!realB || realB.setCode !== cardB.setCode || realB.number !== cardB.number) {
    await sendChatMessage(`Trade failed — ${session.target}'s card is no longer available!`, 'broadcaster', undefined, session.tenantId);
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
    }, normalizeTenantId(session.tenantId));
  }

  await sendChatMessage(
    `✅ Trade complete! @${session.initiator} got ${removedB.name}, @${session.target} got ${removedA.name}!`,
    'broadcaster',
    undefined,
    session.tenantId
  );
}

// Cleanup expired trades
setInterval(() => {
  const now = Date.now();
  for (const [tenantId, tenantTrades] of activeTrades.entries()) {
    for (const [key, session] of tenantTrades.entries()) {
      if (session.expiresAt < now) {
        tenantTrades.delete(key);
        sendChatMessage(
          `Trade between @${session.initiator} and @${session.target} expired!`,
          'broadcaster',
          undefined,
          session.tenantId
        ).catch(() => {});
      }
    }
  }
}, 30000);
