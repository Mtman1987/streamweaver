import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const SEASONS_FILE = path.join(process.cwd(), 'data', 'seasons.json');

type Season = {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  sets: string[];
  active: boolean;
};

function loadSeasons(): Season[] {
  try {
    if (fs.existsSync(SEASONS_FILE)) return JSON.parse(fs.readFileSync(SEASONS_FILE, 'utf-8'));
  } catch {}
  return [];
}

function saveSeasons(seasons: Season[]): void {
  const dir = path.dirname(SEASONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SEASONS_FILE, JSON.stringify(seasons, null, 2));
}

export async function GET() {
  return NextResponse.json({ seasons: loadSeasons() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;
  const seasons = loadSeasons();

  if (action === 'start') {
    // End current active season
    for (const s of seasons) {
      if (s.active) {
        s.active = false;
        s.endDate = new Date().toISOString();
      }
    }
    const num = seasons.length + 1;
    const sets: string[] = body.sets || [];
    seasons.push({
      id: `season-${num}`,
      name: body.name || `Season ${num}`,
      startDate: new Date().toISOString(),
      endDate: null,
      sets,
      active: true,
    });
    saveSeasons(seasons);
    return NextResponse.json({ seasons, started: `season-${num}` });
  }

  if (action === 'end') {
    for (const s of seasons) {
      if (s.active) {
        s.active = false;
        s.endDate = new Date().toISOString();
      }
    }
    saveSeasons(seasons);
    return NextResponse.json({ seasons });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
