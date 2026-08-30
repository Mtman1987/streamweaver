export type CardPackGame = 'pokemon' | 'quackverse';

export type CardPackCard = {
  id?: string;
  number?: string;
  name: string;
  rarity?: string;
  setCode?: string;
  imageUrl: string;
};

export type CardPackOpenedEvent = {
  eventId: string;
  type: 'card-pack-opened';
  game: CardPackGame;
  username: string;
  setName: string;
  cards: CardPackCard[];
  featureCard?: CardPackCard;
  openedAt: string;
};

function cleanText(value: unknown, fallback = '', max = 120): string {
  return String(value || fallback).trim().slice(0, max);
}

function rarityScore(value: unknown): number {
  const rarity = String(value || '').toLowerCase();
  if (rarity.includes('secret') || rarity.includes('legendary')) return 7;
  if (rarity.includes('hyper')) return 6;
  if (rarity.includes('ultra') || rarity.includes('epic')) return 5;
  if (rarity.includes('holo')) return 4;
  if (rarity.includes('rare')) return 3;
  if (rarity.includes('uncommon')) return 2;
  return 1;
}

export function normalizeCardPackEvent(input: any): CardPackOpenedEvent {
  const rawCards = Array.isArray(input?.cards || input?.pack) ? (input.cards || input.pack) : [];
  const cards: CardPackCard[] = rawCards.map((card: any) => ({
    id: cleanText(card?.id, '', 80) || undefined,
    number: cleanText(card?.number, '', 40) || undefined,
    name: cleanText(card?.name, 'Unknown Card', 100),
    rarity: cleanText(card?.rarity, '', 60) || undefined,
    setCode: cleanText(card?.setCode, '', 40) || undefined,
    imageUrl: cleanText(card?.imageUrl || card?.cardImageUrl, '', 1000),
  })).filter((card: CardPackCard) => card.imageUrl).slice(0, 12);
  const featureCard = cards.length
    ? [...cards].sort((a, b) => rarityScore(b.rarity) - rarityScore(a.rarity))[0]
    : undefined;
  const game: CardPackGame = String(input?.game || input?.source || '').toLowerCase().includes('quack') ? 'quackverse' : 'pokemon';
  const eventId = cleanText(input?.eventId || input?.packId || `${game}-${Date.now()}`, '', 120).replace(/[^a-zA-Z0-9._:-]+/g, '-');
  return {
    eventId,
    type: 'card-pack-opened',
    game,
    username: cleanText(input?.username || input?.twitchUsername, 'player', 80),
    setName: cleanText(input?.setName, game === 'quackverse' ? 'Quackverse' : 'Pokemon', 100),
    cards,
    featureCard,
    openedAt: cleanText(input?.openedAt || input?.at, new Date().toISOString(), 80),
  };
}

export function encodeCardPackEvent(event: CardPackOpenedEvent): string {
  return Buffer.from(JSON.stringify(event), 'utf8').toString('base64url');
}

export function buildCardPackRenderUrl(event: CardPackOpenedEvent): string {
  const base = String(process.env.NEXT_PUBLIC_STREAMWEAVE_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.STREAMWEAVER_URL || 'https://streamweaver-new.fly.dev').replace(/\/$/, '');
  return `${base}/overlay/card-pack?event=${encodeURIComponent(encodeCardPackEvent(event))}&capture=1`;
}
