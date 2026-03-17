import fs from 'fs';
import path from 'path';
import { sendChatMessage } from './twitch';
import { updateUser, getUser } from './user-stats';

const BINGO_FILE = path.join(process.cwd(), 'data', 'bingo-state.json');
const CLAIM_REWARD = 50;
const BINGO_REWARD = 250;
const ATHENA_CLAIM_DELAY = 30000; // 30 seconds before Athena claims

interface SquareState {
  phrase: string;
  claimedBy: string | null; // username or 'ATHENA'
  isBlocked: boolean; // true if Athena claimed it
  customPhrase?: string; // player's custom phrase to override
  claimTime?: number;
}

interface BingoState {
  active: boolean;
  squares: SquareState[]; // 25 squares
  phraseTimers: Record<number, number>; // squareIdx -> timestamp when phrase was said
  lastUpdate: number;
}

let bingoState: BingoState = {
  active: false,
  squares: [],
  phraseTimers: {},
  lastUpdate: 0
};

function loadBingo(): BingoState {
  if (!fs.existsSync(BINGO_FILE)) {
    return { active: false, squares: [], phraseTimers: {}, lastUpdate: 0 };
  }
  return JSON.parse(fs.readFileSync(BINGO_FILE, 'utf-8'));
}

function saveBingo() {
  fs.mkdirSync(path.dirname(BINGO_FILE), { recursive: true });
  fs.writeFileSync(BINGO_FILE, JSON.stringify(bingoState, null, 2));
}

function generateASCIICard(): string {
  let card = '```\n';
  card += ' B  I  N  G  O\n';
  
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col;
      const square = bingoState.squares[idx];
      
      if (square.isBlocked) {
        card += '[A]';
      } else if (square.claimedBy) {
        card += '[X]';
      } else {
        card += '[ ]';
      }
    }
    card += '\n';
  }
  card += '```';
  
  return card;
}

function checkBingo(): { winner: boolean; players: string[] } {
  const claimedSquares = bingoState.squares.map((s, i) => 
    (s.claimedBy && !s.isBlocked) ? i : -1
  ).filter(i => i !== -1);
  
  // Check rows
  for (let row = 0; row < 5; row++) {
    const rowIndices = [row * 5, row * 5 + 1, row * 5 + 2, row * 5 + 3, row * 5 + 4];
    if (rowIndices.every(i => claimedSquares.includes(i))) {
      const players = rowIndices.map(i => bingoState.squares[i].claimedBy).filter(p => p && p !== 'ATHENA');
      return { winner: true, players: [...new Set(players)] as string[] };
    }
  }
  
  // Check columns
  for (let col = 0; col < 5; col++) {
    const colIndices = [col, col + 5, col + 10, col + 15, col + 20];
    if (colIndices.every(i => claimedSquares.includes(i))) {
      const players = colIndices.map(i => bingoState.squares[i].claimedBy).filter(p => p && p !== 'ATHENA');
      return { winner: true, players: [...new Set(players)] as string[] };
    }
  }
  
  // Check diagonals
  const diag1 = [0, 6, 12, 18, 24];
  const diag2 = [4, 8, 12, 16, 20];
  if (diag1.every(i => claimedSquares.includes(i))) {
    const players = diag1.map(i => bingoState.squares[i].claimedBy).filter(p => p && p !== 'ATHENA');
    return { winner: true, players: [...new Set(players)] as string[] };
  }
  if (diag2.every(i => claimedSquares.includes(i))) {
    const players = diag2.map(i => bingoState.squares[i].claimedBy).filter(p => p && p !== 'ATHENA');
    return { winner: true, players: [...new Set(players)] as string[] };
  }
  
  return { winner: false, players: [] };
}

export async function handleBingoCard(username: string) {
  bingoState = loadBingo();
  
  if (!bingoState.active) {
    await sendChatMessage(`@${username}, no bingo game active!`, 'bot');
    return;
  }
  
  const card = generateASCIICard();
  await sendChatMessage(card, 'bot');
}

export async function handleBingoPhrases(username: string) {
  bingoState = loadBingo();
  
  if (!bingoState.active) {
    await sendChatMessage(`@${username}, no bingo game active!`, 'bot');
    return;
  }
  
  const rows = ['B', 'I', 'N', 'G', 'O'];
  let messages: string[] = [];
  let currentMsg = '';
  
  for (let i = 0; i < bingoState.squares.length; i++) {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const square = bingoState.squares[i];
    const phrase = square.customPhrase || square.phrase;
    const status = square.isBlocked ? '🔒' : square.claimedBy ? '✓' : '';
    const entry = `${rows[col]}${row + 1}:${phrase}${status} `;
    
    if ((currentMsg + entry).length > 450) {
      messages.push(currentMsg.trim());
      currentMsg = entry;
    } else {
      currentMsg += entry;
    }
  }
  if (currentMsg) messages.push(currentMsg.trim());
  
  for (const msg of messages) {
    await sendChatMessage(msg, 'bot');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export async function handleClaimSquare(username: string, square: string) {
  bingoState = loadBingo();
  
  if (!bingoState.active) {
    await sendChatMessage(`@${username}, no bingo game active!`, 'bot');
    return;
  }
  
  const match = square.toUpperCase().match(/^([BINGO])([1-5])$/);
  if (!match) {
    await sendChatMessage(`@${username}, invalid square! Use B1, N3, O5`, 'bot');
    return;
  }
  
  const [, letter, num] = match;
  const col = ['B', 'I', 'N', 'G', 'O'].indexOf(letter);
  const row = parseInt(num) - 1;
  const idx = row * 5 + col;
  
  const sq = bingoState.squares[idx];
  
  if (sq.isBlocked) {
    await sendChatMessage(`@${username}, ${square} is blocked by Athena! Use !override ${square} "your phrase" to unblock`, 'bot');
    return;
  }
  
  if (sq.claimedBy) {
    await sendChatMessage(`@${username}, ${square} already claimed by @${sq.claimedBy}!`, 'bot');
    return;
  }
  
  sq.claimedBy = username;
  sq.claimTime = Date.now();
  saveBingo();
  
  const user = await getUser(username);
  await updateUser(username, { points: user.points + CLAIM_REWARD });
  
  await sendChatMessage(`✅ @${username} claimed ${square}: "${sq.phrase}"! +${CLAIM_REWARD} pts`, 'bot');
  
  const result = checkBingo();
  if (result.winner) {
    for (const player of result.players) {
      const u = await getUser(player);
      await updateUser(player, { points: u.points + BINGO_REWARD });
    }
    await sendChatMessage(`🎉 BINGO! Chat wins! ${result.players.map(p => '@' + p).join(', ')} +${BINGO_REWARD} pts each!`, 'bot');
  }
}

export async function handleOverride(username: string, square: string, customPhrase: string) {
  bingoState = loadBingo();
  
  if (!bingoState.active) return;
  
  const match = square.toUpperCase().match(/^([BINGO])([1-5])$/);
  if (!match) return;
  
  const [, letter, num] = match;
  const col = ['B', 'I', 'N', 'G', 'O'].indexOf(letter);
  const row = parseInt(num) - 1;
  const idx = row * 5 + col;
  
  const sq = bingoState.squares[idx];
  
  if (!sq.isBlocked) {
    await sendChatMessage(`@${username}, ${square} isn't blocked!`, 'bot');
    return;
  }
  
  sq.customPhrase = customPhrase;
  sq.isBlocked = false;
  sq.claimedBy = null;
  delete bingoState.phraseTimers[idx];
  saveBingo();
  
  await sendChatMessage(`🔓 @${username} overrode ${square} with "${customPhrase}"! Now trick the streamer into saying it!`, 'bot');
}

// Check for phrases and start Athena timer
export async function checkForBingoPhrase(message: string, username: string) {
  bingoState = loadBingo();
  
  if (!bingoState.active) return;
  
  // Ignore bot messages to prevent Athena from triggering her own phrases
  if (username.toLowerCase() === 'athenabot87' || username.toLowerCase() === 'athena') return;
  
  const lowerMessage = message.toLowerCase();
  
  for (let i = 0; i < bingoState.squares.length; i++) {
    const sq = bingoState.squares[i];
    const phrase = (sq.customPhrase || sq.phrase).toLowerCase();
    
    // Use word boundary regex to avoid false matches (e.g., "GG" in "Jigglypuff")
    const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    
    if (regex.test(message) && !sq.claimedBy && !sq.isBlocked && !bingoState.phraseTimers[i]) {
      bingoState.phraseTimers[i] = Date.now();
      saveBingo();
      
      const rows = ['B', 'I', 'N', 'G', 'O'];
      const row = Math.floor(i / 5);
      const col = i % 5;
      const square = `${rows[col]}${row + 1}`;
      
      await sendChatMessage(`🚨 "${sq.customPhrase || sq.phrase}" detected! ${square} available! Claim it fast or Athena will block it in 30s!`, 'bot');
    }
  }
}

// Athena claims unclaimed squares (call periodically)
export async function athenaClaimCheck() {
  bingoState = loadBingo();
  
  if (!bingoState.active) return;
  
  const now = Date.now();
  const rows = ['B', 'I', 'N', 'G', 'O'];
  
  for (const [idxStr, timestamp] of Object.entries(bingoState.phraseTimers)) {
    const idx = parseInt(idxStr);
    const sq = bingoState.squares[idx];
    
    if (!sq.claimedBy && !sq.isBlocked && (now - timestamp) >= ATHENA_CLAIM_DELAY) {
      sq.isBlocked = true;
      sq.claimedBy = 'ATHENA';
      delete bingoState.phraseTimers[idx];
      saveBingo();
      
      const row = Math.floor(idx / 5);
      const col = idx % 5;
      const square = `${rows[col]}${row + 1}`;
      
      await sendChatMessage(`🔒 Athena blocked ${square}! Too slow, chat! Use !override ${square} "phrase" to unblock it.`, 'bot');
    }
  }
}

export async function handleNewBingoGame(aiPhrases?: string[]) {
  let phrases: string[];
  
  if (aiPhrases) {
    phrases = aiPhrases;
  } else {
    // Try to generate AI phrases
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
      if (apiKey) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `Generate exactly 25 unique, short (2-4 words) phrases that a Twitch streamer might say during gameplay. Make them varied - include reactions, common gaming terms, and stream-specific moments. Format as a simple comma-separated list. Examples: "GG", "First death", "Epic win", "Drinks water", "Pet appears"` }]
            }],
            generationConfig: {
              temperature: 0.9,
              maxOutputTokens: 300
            }
          })
        });
        
        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;
        phrases = text.split(',').map((p: string) => p.trim().replace(/^"|"$/g, '')).slice(0, 25);
        
        // Ensure we have exactly 25
        while (phrases.length < 25) {
          phrases.push(`Phrase ${phrases.length + 1}`);
        }
        
        console.log('[Bingo] Generated AI phrases:', phrases);
      } else {
        throw new Error('No API key');
      }
    } catch (error) {
      console.log('[Bingo] AI generation failed, using defaults:', error);
      // Fallback to default phrases
      phrases = [
        'GG', 'Hype!', 'F in chat', 'Poggers', 'LUL',
        'First death', 'Epic win', 'Streamer laughs', 'Drinks water', 'Pet appears',
        'Raid incoming', 'New sub', 'FREE SPACE', 'Donation alert', 'New follower',
        'Lag spike', 'Chat spams emotes', 'Tells a story', 'Sings along', 'Dance break',
        'Game crashes', 'Viewer count doubles', 'Emote only mode', 'Inside joke', 'Gets emotional'
      ];
    }
  }
  
  bingoState = {
    active: true,
    squares: phrases.map(phrase => ({
      phrase,
      claimedBy: null,
      isBlocked: false
    })),
    phraseTimers: {},
    lastUpdate: Date.now()
  };
  saveBingo();
  
  await sendChatMessage(`🎲 CHAT VS ATHENA BINGO! Claim squares when phrases happen (+50pts). 5 in a row = BINGO (+250pts). Athena will block unclaimed squares after 30s!`, 'bot');
}

// Initialize
bingoState = loadBingo();
