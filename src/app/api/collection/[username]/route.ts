import { NextRequest, NextResponse } from 'next/server';
import { getUserCollection } from '@/services/pokemon-storage-discord';
import { generatePokedexHtml } from '@/services/pokedex-html';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const collection = await getUserCollection(username);
  if (!collection.cards.length) {
    return new NextResponse(`<html><body style="background:#111;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><h1>${username} has no cards yet.</h1></body></html>`, { headers: { 'Content-Type': 'text/html' } });
  }
  const html = await generatePokedexHtml(username, collection.cards, collection.packsOpened);
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
}
