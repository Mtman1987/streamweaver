import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const setCode = searchParams.get('set');
  const number = searchParams.get('number');
  const cardName = searchParams.get('name');

  if (!setCode || !number) {
    return new NextResponse('Missing parameters', { status: 400 });
  }

  const databasePath = path.join(process.cwd(), 'carddb-uploader', 'cards', 'database');

  // Try with card name first if provided
  if (cardName && cardName !== 'Unknown') {
    const cleanName = cardName.replace(/[^a-zA-Z0-9 -]/g, '');
    const localPath = path.join(databasePath, `${cleanName}_${number}_${setCode}.jpg`);
    
    if (fs.existsSync(localPath)) {
      const imageBuffer = fs.readFileSync(localPath);
      return new NextResponse(imageBuffer, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
  }

  // Search database folder for matching file by pattern: *_number_setCode.jpg
  try {
    const files = fs.readdirSync(databasePath);
    const pattern = new RegExp(`^.+_${number}_${setCode}\.jpg$`, 'i');
    const matchingFile = files.find(file => pattern.test(file));
    
    if (matchingFile) {
      const imageBuffer = fs.readFileSync(path.join(databasePath, matchingFile));
      return new NextResponse(imageBuffer, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
  } catch (error) {
    console.error('Error searching database:', error);
  }

  // Fallback to Pokemon TCG API
  try {
    let imageUrl = `https://images.pokemontcg.io/${setCode}-${number}_hires.png`;
    let response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      imageUrl = `https://images.pokemontcg.io/${setCode}-${number}.png`;
      response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
    }
    
    if (!response.ok) {
      return new NextResponse('Image not found', { status: 404 });
    }

    const imageBuffer = await response.arrayBuffer();
    
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error fetching Pokemon card image:', error);
    return new NextResponse('Error fetching image', { status: 500 });
  }
}
