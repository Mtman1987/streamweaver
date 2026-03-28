import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const personal = searchParams.get('personal') === 'true';
  const username = searchParams.get('username') || 'Player';

  try {
    // Load bingo state
    const bingoPath = join(process.cwd(), 'data', 'bingo-state.json');
    if (!existsSync(bingoPath)) {
      return NextResponse.json(
        { 
          success: false,
          error: 'No active bingo game', 
          message: 'Start a game with !newbingo',
          personalOnly: personal
        },
        { status: 404 }
      );
    }

    const bingoState = JSON.parse(readFileSync(bingoPath, 'utf-8'));

    if (!bingoState.active) {
      return NextResponse.json(
        { 
          success: false,
          error: 'No active bingo game', 
          message: 'Start a game with !newbingo',
          personalOnly: personal
        },
        { status: 404 }
      );
    }

    // Generate ASCII card
    const card = generateASCIICard(bingoState, username);

    // Always return JSON format
    return NextResponse.json({
      success: true,
      username,
      card,
      isActive: bingoState.active,
      totalSquares: bingoState.squares?.length || 0,
      claimedSquares: bingoState.squares?.filter((s: any) => s.claimedBy).length || 0,
      personalOnly: personal,
      message: `🎲 [Only seen in your chat] Here's your bingo card, @${username}!`,
      viewerOnlyNotice: personal ? '[Only visible to you - NOT posted in shared chat]' : null,
    });
  } catch (error) {
    console.error('[Bingo API] Error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to load bingo card',
        personalOnly: personal
      },
      { status: 500 }
    );
  }
}

function generateASCIICard(bingoState: any, username: string): string {
  const squares = bingoState.squares || [];
  const rows = ['B', 'I', 'N', 'G', 'O'];

  let card = '\n```\n';
  card += `╔═══════════════════════════════════════════════════════╗\n`;
  card += `║        🎲 BINGO CARD - ${username.toUpperCase().padEnd(34)}║\n`;
  card += `╚═══════════════════════════════════════════════════════╝\n\n`;

  // Header
  card += `   B          I          N          G          O\n`;
  card += `─────────────────────────────────────────────────────\n`;

  // 5 rows x 5 columns
  for (let row = 0; row < 5; row++) {
    card += ' ';
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col;
      const square = squares[idx] || { phrase: '', claimedBy: null, isBlocked: false };
      const status = square.isBlocked ? '🔒' : square.claimedBy ? '✓' : '·';

      const phrase = (square.customPhrase || square.phrase || '').substring(0, 8);
      const cell = `${phrase}${status}`.padEnd(10);
      card += cell;
    }
    card += '\n';
    if (row < 4) card += '\n';
  }

  card += `\n─────────────────────────────────────────────────────\n`;
  card += `Legend: ✓ = Claimed | 🔒 = Blocked by Athena | · = Unclaimed\n`;
  card += '```';

  return card;
}
