import { getConfiguredAppUrl } from '../lib/runtime-origin';

function cleanPokemonUser(value: unknown): string {
  return String(value || '').trim().replace(/^@/, '').toLowerCase().slice(0, 80);
}

export function buildPokemonBrowserUrl(
  username: unknown,
  options: { card?: unknown; tradeWith?: unknown } = {},
): string {
  const owner = cleanPokemonUser(username);
  const url = new URL('/api/pokedex', getConfiguredAppUrl());
  url.searchParams.set('user', owner);

  const card = String(options.card || '').trim().slice(0, 120);
  if (card) url.searchParams.set('card', card);

  const tradeWith = cleanPokemonUser(options.tradeWith);
  if (tradeWith && tradeWith !== owner) url.searchParams.set('trade', tradeWith);

  return url.toString();
}
