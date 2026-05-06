import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const POKEDEX_DIR = path.join(process.env.PERSIST_ROOT || path.join(process.cwd(), 'data', 'runtime'), 'global', 'pokedex');

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get('user');
  if (!username) {
    return NextResponse.json({ error: 'user param required' }, { status: 400 });
  }

  const filePath = path.join(POKEDEX_DIR, `${username.toLowerCase()}.html`);
  try {
    const html = await fs.readFile(filePath, 'utf-8');
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch {
    return NextResponse.json({ error: 'Pokedex not found' }, { status: 404 });
  }
}
