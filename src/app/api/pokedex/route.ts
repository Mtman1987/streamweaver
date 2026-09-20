import { NextRequest, NextResponse } from 'next/server';
import { getUserCollection } from '@/services/pokemon-storage-discord';
import { generatePokedexHtml } from '@/services/pokedex-html';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const username = String(request.nextUrl.searchParams.get('user') || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();

  if (!username) {
    return NextResponse.json({ error: 'user param required' }, { status: 400 });
  }

  const collection = await getUserCollection(username);
  const html = await generatePokedexHtml(username, collection.cards, collection.packsOpened || 0);

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
