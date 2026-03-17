import { sendChatMessage } from './twitch';
import { getUserCards, removeCardFromUser } from './pokemon-collection';
import { getUserCollection, saveUserCollection } from './pokemon-storage-discord';

type PendingSwap = {
  from: string;
  to: string;
  fromIdx: number;
  toIdx: number;
  fromCard: { name: string; rarity: string };
  toCard: { name: string; rarity: string };
  timestamp: number;
};

const pendingSwaps = new Map<string, PendingSwap>();

export async function proposeSwap(fromUser: string, toUser: string, fromCardNum: number, toCardNum: number): Promise<void> {
  const fromCards = await getUserCards(fromUser);
  const toCards = await getUserCards(toUser);

  const fromIdx = fromCardNum - 1;
  const toIdx = toCardNum - 1;

  if (!fromCards[fromIdx]) {
    await sendChatMessage(`@${fromUser}, you don't have card #${fromCardNum}!`, 'broadcaster').catch(() => {});
    return;
  }
  if (!toCards[toIdx]) {
    await sendChatMessage(`@${fromUser}, ${toUser} doesn't have card #${toCardNum}!`, 'broadcaster').catch(() => {});
    return;
  }

  const fc = fromCards[fromIdx];
  const tc = toCards[toIdx];

  pendingSwaps.set(toUser.toLowerCase(), {
    from: fromUser.toLowerCase(),
    to: toUser.toLowerCase(),
    fromIdx,
    toIdx,
    fromCard: { name: fc.name, rarity: fc.rarity || 'Common' },
    toCard: { name: tc.name, rarity: tc.rarity || 'Common' },
    timestamp: Date.now(),
  });

  // Auto-expire after 60 seconds
  setTimeout(() => {
    const p = pendingSwaps.get(toUser.toLowerCase());
    if (p && p.from === fromUser.toLowerCase()) {
      pendingSwaps.delete(toUser.toLowerCase());
    }
  }, 60000);

  await sendChatMessage(
    `🔄 @${fromUser} wants to swap their ${fc.name} (${fc.rarity || 'Common'}) for @${toUser}'s ${tc.name} (${tc.rarity || 'Common'}). @${toUser} type !accept or !cancel (60s)`,
    'broadcaster'
  ).catch(() => {});

  if (typeof (global as any).broadcast === 'function') {
    (global as any).broadcast({
      type: 'pokemon-swap-proposal',
      payload: { from: fromUser, to: toUser, fromCard: fc, toCard: tc },
    });
  }
}

export async function acceptSwap(username: string): Promise<boolean> {
  const key = username.toLowerCase();
  const swap = pendingSwaps.get(key);
  if (!swap) return false;

  pendingSwaps.delete(key);

  // Re-validate cards still exist at those indices
  const fromCards = await getUserCards(swap.from);
  const toCards = await getUserCards(swap.to);

  if (!fromCards[swap.fromIdx] || fromCards[swap.fromIdx].name !== swap.fromCard.name) {
    await sendChatMessage(`Swap failed — ${swap.from}'s card is no longer available.`, 'broadcaster').catch(() => {});
    return true;
  }
  if (!toCards[swap.toIdx] || toCards[swap.toIdx].name !== swap.toCard.name) {
    await sendChatMessage(`Swap failed — ${swap.to}'s card is no longer available.`, 'broadcaster').catch(() => {});
    return true;
  }

  // Remove cards (higher index first to avoid shifting)
  const removedFrom = await removeCardFromUser(swap.from, swap.fromIdx);
  const removedTo = await removeCardFromUser(swap.to, swap.toIdx > swap.fromIdx && swap.from === swap.to ? swap.toIdx - 1 : swap.toIdx);

  if (!removedFrom || !removedTo) {
    await sendChatMessage(`Swap failed — could not remove cards.`, 'broadcaster').catch(() => {});
    return true;
  }

  // Add cards to opposite users (direct push, no packsOpened increment)
  const fromCol = await getUserCollection(swap.from);
  fromCol.cards.push(removedTo);
  await saveUserCollection(swap.from, fromCol);

  const toCol = await getUserCollection(swap.to);
  toCol.cards.push(removedFrom);
  await saveUserCollection(swap.to, toCol);

  await sendChatMessage(
    `✅ Swap complete! ${swap.from} got ${swap.toCard.name} (${swap.toCard.rarity}) ↔ ${swap.to} got ${swap.fromCard.name} (${swap.fromCard.rarity})`,
    'broadcaster'
  ).catch(() => {});

  return true;
}

export async function cancelSwap(username: string): Promise<boolean> {
  const key = username.toLowerCase();
  const swap = pendingSwaps.get(key);
  if (!swap) {
    // Also check if this user is the proposer
    for (const [k, s] of pendingSwaps) {
      if (s.from === key) {
        pendingSwaps.delete(k);
        await sendChatMessage(`🚫 Swap cancelled by ${username}.`, 'broadcaster').catch(() => {});
        return true;
      }
    }
    return false;
  }
  pendingSwaps.delete(key);
  await sendChatMessage(`🚫 Swap declined by ${username}.`, 'broadcaster').catch(() => {});
  return true;
}

export function hasPendingSwap(username: string): boolean {
  const key = username.toLowerCase();
  if (pendingSwaps.has(key)) return true;
  for (const s of pendingSwaps.values()) {
    if (s.from === key) return true;
  }
  return false;
}
