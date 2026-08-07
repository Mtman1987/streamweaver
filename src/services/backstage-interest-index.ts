import { getBotInterests } from '@/lib/bot-settings-store';
import { listTenants } from '@/lib/tenant';

const CACHE_TTL_MS = 60_000;

let cachedIndex: {
  expiresAt: number;
  tags: string[];
} | null = null;

const INTEREST_PATTERNS: Record<string, RegExp> = {
  joke: /\b(?:joke|funny|punchline|knock[- ]?knock|dad joke|what do you call|why did)\b/i,
  jokes: /\b(?:joke|funny|punchline|knock[- ]?knock|dad joke|what do you call|why did)\b/i,
  humor: /\b(?:joke|funny|humou?r|comedy|punchline|laugh)\b/i,
  comedy: /\b(?:joke|funny|humou?r|comedy|punchline|laugh)\b/i,
  music: /\b(?:music|song|album|band|singer|concert|playlist|melody|lyrics?)\b/i,
  gaming: /\b(?:game|gaming|playthrough|boss fight|speedrun|multiplayer)\b/i,
  games: /\b(?:game|gaming|playthrough|boss fight|speedrun|multiplayer)\b/i,
  fishing: /\b(?:fish|fishing|trout|bass|salmon|bait|lure|dock)\b/i,
  pokemon: /\b(?:pok[eé]mon|pikachu|eevee|booster pack|trainer|pok[eé]dex)\b/i,
  crafts: /\b(?:craft|crochet|knit|sew|yarn|glitter|handmade)\b/i,
  art: /\b(?:art|draw|drawing|paint|illustration|design)\b/i,
  horror: /\b(?:horror|scary|spooky|nightmare|ghost|haunt)\b/i,
  coding: /\b(?:code|coding|programming|developer|bug|software)\b/i,
  tech: /\b(?:tech|technology|computer|ai|robot|software|hardware)\b/i,
};

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function parseInterestIndexTags(value: unknown): string[] {
  return Array.from(new Set(String(value || '')
    .split(/[,;|\n]+/)
    .map(normalize)
    .filter(Boolean)));
}

export function publicObservationMatchesInterest(text: string, interests: string[]): boolean {
  const haystack = normalize(text);
  if (!haystack) return false;
  return interests.some((rawTag) => {
    const tag = normalize(rawTag);
    if (!tag) return false;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exact = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
    const singular = tag.endsWith('s') && tag.length > 3
      ? new RegExp(`(^|[^a-z0-9])${tag.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?([^a-z0-9]|$)`, 'i').test(haystack)
      : false;
    return exact || singular || INTEREST_PATTERNS[tag]?.test(text) === true;
  });
}

async function getInterestIndex(): Promise<string[]> {
  if (cachedIndex && cachedIndex.expiresAt > Date.now()) return cachedIndex.tags;
  const tags = new Set<string>();
  for (const tenantId of await listTenants()) {
    if (!tenantId || tenantId.startsWith('__kick_silent__')) continue;
    for (const tag of parseInterestIndexTags(getBotInterests(tenantId))) tags.add(tag);
  }
  cachedIndex = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    tags: Array.from(tags),
  };
  return cachedIndex.tags;
}

export async function shouldQueueBackstagePublicObservation(text: string): Promise<boolean> {
  const interests = await getInterestIndex();
  return interests.length > 0 && publicObservationMatchesInterest(text, interests);
}

export function clearBackstageInterestIndexCache(): void {
  cachedIndex = null;
}
