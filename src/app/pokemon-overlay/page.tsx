import { redirect } from 'next/navigation';

type SearchValue = string | string[] | undefined;

export default async function LegacyPokemonOverlay({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const values = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(values || {})) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else if (typeof value === 'string') {
      query.set(key, value);
    }
  }

  const suffix = query.toString();
  redirect(`/pokemon-pack-overlay${suffix ? `?${suffix}` : ''}`);
}
