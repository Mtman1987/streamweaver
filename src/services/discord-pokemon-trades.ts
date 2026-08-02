import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { globalPath } from '@/lib/tenant';
import { getUserCards } from './pokemon-collection';
import { swapPokemonCards } from './pokemon-storage-discord';

type TradeCard = {
  index: number;
  name: string;
  number: string;
  setCode: string;
  rarity: string;
  imageUrl?: string;
  openedAt?: string;
};

export type DiscordPokemonTrade = {
  id: string;
  tenantId?: string;
  guildId: string;
  channelId: string;
  initiator: { discordId: string; discordName: string; pokemonUser: string };
  target: { discordId: string; discordName: string; pokemonUser: string };
  offers: Record<string, TradeCard | undefined>;
  acceptedBy: string[];
  status: 'selecting' | 'ready' | 'completed' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
};

type TradeStore = { trades: DiscordPokemonTrade[] };
const STORE_FILE = globalPath('discord-pokemon-trades.json');
const TRADE_TTL_MS = 10 * 60 * 1000;
let mutationQueue: Promise<unknown> = Promise.resolve();

async function readStore(): Promise<TradeStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(STORE_FILE, 'utf8'));
    return { trades: Array.isArray(parsed?.trades) ? parsed.trades : [] };
  } catch {
    return { trades: [] };
  }
}

async function writeStore(store: TradeStore): Promise<void> {
  await fs.mkdir(dirname(STORE_FILE), { recursive: true });
  const temp = `${STORE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(store, null, 2));
  await fs.rename(temp, STORE_FILE);
}

function active(trade: DiscordPokemonTrade): boolean {
  return ['selecting', 'ready'].includes(trade.status) && Date.parse(trade.expiresAt) > Date.now();
}

async function mutate<T>(operation: (store: TradeStore) => Promise<T>): Promise<T> {
  const run = mutationQueue.then(async () => {
    const store = await readStore();
    let changed = false;
    for (const trade of store.trades) {
      if (['selecting', 'ready'].includes(trade.status) && Date.parse(trade.expiresAt) <= Date.now()) {
        trade.status = 'expired';
        changed = true;
      }
    }
    const result = await operation(store);
    await writeStore({ trades: store.trades.slice(-250) });
    return result;
  });
  mutationQueue = run.catch(() => {});
  return run;
}

function participant(trade: DiscordPokemonTrade, discordId: string) {
  if (trade.initiator.discordId === discordId) return trade.initiator;
  if (trade.target.discordId === discordId) return trade.target;
  return null;
}

function findCard(cards: any[], identifier: string): TradeCard | null {
  const normalized = String(identifier || '').trim().toLowerCase();
  if (!normalized) return null;
  const indexNumber = Number(normalized.replace(/^#/, ''));
  let matches: Array<{ card: any; index: number }> = [];

  if (Number.isInteger(indexNumber) && indexNumber >= 1 && indexNumber <= cards.length) {
    matches = [{ card: cards[indexNumber - 1], index: indexNumber - 1 }];
  } else {
    const setMatch = normalized.match(/^([a-z0-9]+)-(.+)$/i);
    matches = cards
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => setMatch
        ? String(card.setCode).toLowerCase() === setMatch[1] && String(card.number).toLowerCase() === setMatch[2]
        : String(card.name).toLowerCase().includes(normalized));
  }

  if (matches.length !== 1) return null;
  const { card, index } = matches[0];
  return {
    index,
    name: card.name,
    number: card.number,
    setCode: card.setCode,
    rarity: card.rarity || 'Common',
    imageUrl: card.imageUrl,
    openedAt: card.openedAt,
  };
}

function lockedElsewhere(store: TradeStore, tradeId: string, pokemonUser: string, card: TradeCard): boolean {
  return store.trades.some((trade) => {
    if (trade.id === tradeId || !active(trade)) return false;
    return Object.entries(trade.offers).some(([discordId, offer]) => {
      const owner = participant(trade, discordId);
      return owner?.pokemonUser === pokemonUser &&
        offer?.setCode === card.setCode &&
        offer?.number === card.number &&
        offer?.index === card.index;
    });
  });
}

export async function createDiscordPokemonTrade(input: {
  tenantId?: string;
  guildId: string;
  channelId: string;
  initiator: DiscordPokemonTrade['initiator'];
  target: DiscordPokemonTrade['target'];
}): Promise<DiscordPokemonTrade> {
  return mutate(async (store) => {
    if (input.initiator.discordId === input.target.discordId) throw new Error('You cannot trade with yourself.');
    const existing = store.trades.find((trade) =>
      active(trade) &&
      [trade.initiator.discordId, trade.target.discordId].some((id) =>
        id === input.initiator.discordId || id === input.target.discordId
      )
    );
    if (existing) throw new Error('One of those players already has an active trade.');

    const trade: DiscordPokemonTrade = {
      id: randomUUID(),
      tenantId: input.tenantId,
      guildId: input.guildId,
      channelId: input.channelId,
      initiator: input.initiator,
      target: input.target,
      offers: {},
      acceptedBy: [],
      status: 'selecting',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + TRADE_TTL_MS).toISOString(),
    };
    store.trades.push(trade);
    return trade;
  });
}


export async function getDiscordPokemonTrade(tradeId: string): Promise<DiscordPokemonTrade | null> {
  const store = await readStore();
  const trade = store.trades.find((entry) => entry.id === tradeId) || null;
  return trade && active(trade) ? trade : null;
}

export async function getDiscordPokemonTradeCards(
  tradeId: string,
  actorDiscordId: string,
  view: 'mine' | 'theirs',
): Promise<{ trade: DiscordPokemonTrade; owner: DiscordPokemonTrade['initiator']; cards: TradeCard[] }> {
  const trade = await getDiscordPokemonTrade(tradeId);
  if (!trade) throw new Error('That trade is no longer active.');
  const actor = participant(trade, actorDiscordId);
  if (!actor) throw new Error('Only the two players in this trade can view these cards.');
  const owner = view === 'mine'
    ? actor
    : actor.discordId === trade.initiator.discordId
      ? trade.target
      : trade.initiator;
  const cards = (await getUserCards(owner.pokemonUser)).map((card: any, index: number) => ({
    index,
    name: String(card.name || 'Unknown card'),
    number: String(card.number || ''),
    setCode: String(card.setCode || ''),
    rarity: String(card.rarity || 'Common'),
    imageUrl: card.imageUrl,
    openedAt: card.openedAt,
  }));
  return { trade, owner, cards };
}

export async function offerDiscordPokemonCard(
  discordId: string,
  identifier: string,
): Promise<DiscordPokemonTrade> {
  return mutate(async (store) => {
    const trade = store.trades.find((entry) => active(entry) && participant(entry, discordId));
    if (!trade) throw new Error('You do not have an active trade.');
    const actor = participant(trade, discordId)!;
    const cards = await getUserCards(actor.pokemonUser);
    const card = findCard(cards, identifier);
    if (!card) throw new Error('Choose one exact card using its collection number, set-number, or full card name.');
    if (lockedElsewhere(store, trade.id, actor.pokemonUser, card)) {
      throw new Error('That card is already reserved in another active trade.');
    }
    trade.offers[discordId] = card;
    trade.acceptedBy = [];
    trade.status = trade.offers[trade.initiator.discordId] && trade.offers[trade.target.discordId] ? 'ready' : 'selecting';
    trade.expiresAt = new Date(Date.now() + TRADE_TTL_MS).toISOString();
    return trade;
  });
}

export async function actOnDiscordPokemonTrade(
  tradeId: string,
  discordId: string,
  action: 'accept' | 'decline',
): Promise<{ trade: DiscordPokemonTrade; completed?: { cardA: TradeCard; cardB: TradeCard } }> {
  return mutate(async (store) => {
    const trade = store.trades.find((entry) => entry.id === tradeId);
    if (!trade || !active(trade)) throw new Error('That trade is no longer active.');
    if (!participant(trade, discordId)) throw new Error('Only the two players in this trade can use these controls.');
    if (action === 'decline') {
      trade.status = 'cancelled';
      return { trade };
    }
    const offerA = trade.offers[trade.initiator.discordId];
    const offerB = trade.offers[trade.target.discordId];
    if (!offerA || !offerB || trade.status !== 'ready') throw new Error('Both players must offer a card first.');
    if (!trade.acceptedBy.includes(discordId)) trade.acceptedBy.push(discordId);
    if (trade.acceptedBy.length < 2) return { trade };

    const swapped = await swapPokemonCards({
      userA: trade.initiator.pokemonUser,
      userB: trade.target.pokemonUser,
      cardIndexA: offerA.index,
      cardIndexB: offerB.index,
      expectedA: offerA,
      expectedB: offerB,
    });
    trade.status = 'completed';
    return {
      trade,
      completed: {
        cardA: { ...offerA, ...swapped.cardA },
        cardB: { ...offerB, ...swapped.cardB },
      },
    };
  });
}

export function formatDiscordPokemonTrade(trade: DiscordPokemonTrade): string {
  const line = (person: DiscordPokemonTrade['initiator']) => {
    const card = trade.offers[person.discordId];
    const accepted = trade.acceptedBy.includes(person.discordId);
    const indicator = accepted ? '🟢' : card ? '🟡' : '🔴';
    const detail = card
      ? `${card.name} (${card.setCode}-${card.number}) • ${card.rarity}`
      : 'selecting a card';
    return `${indicator} **${person.discordName}** — ${detail}${accepted ? ' • accepted' : ''}`;
  };

  const instruction = trade.status === 'ready'
    ? 'Both cards are selected. Each player must review and press **Accept Trade**.'
    : 'Use **Choose My Card** to open your collection, then select an eligible card.';

  return [
    line(trade.initiator),
    line(trade.target),
    '',
    instruction,
    `Trade expires <t:${Math.floor(Date.parse(trade.expiresAt) / 1000)}:R>.`,
  ].join('\n');
}

export function discordPokemonTradeComponents(trade: DiscordPokemonTrade) {
  if (!['selecting', 'ready'].includes(trade.status)) return [];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: 'Choose My Card', custom_id: `sw_pokemon_trade_cards:${trade.id}:mine` },
        { type: 2, style: 2, label: 'View Their Cards', custom_id: `sw_pokemon_trade_cards:${trade.id}:theirs` },
      ],
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: 'Accept Trade',
          custom_id: `sw_pokemon_trade_accept:${trade.id}`,
          disabled: trade.status !== 'ready',
        },
        { type: 2, style: 4, label: 'Decline', custom_id: `sw_pokemon_trade_decline:${trade.id}` },
      ],
    },
  ];
}
