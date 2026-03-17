import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const SETS_FILE = path.join(process.cwd(), 'pokemon-tcg-data-master', 'sets', 'en.json');

export async function GET() {
  try {
    if (!fs.existsSync(SETS_FILE)) {
      return NextResponse.json({ sets: [] });
    }
    const sets = JSON.parse(fs.readFileSync(SETS_FILE, 'utf-8'));
    // Return id, name, series, total, images only
    const slim = sets.map((s: any) => ({
      id: s.id,
      name: s.name,
      series: s.series,
      total: s.total,
      releaseDate: s.releaseDate,
      images: s.images,
    }));
    return NextResponse.json({ sets: slim });
  } catch (err) {
    return NextResponse.json({ sets: [], error: String(err) }, { status: 500 });
  }
}
