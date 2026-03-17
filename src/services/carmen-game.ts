import fs from 'fs';
import path from 'path';
import { sendDiscordMessage } from './discord';
import { sendChatMessage } from './twitch';
import { updateUser, getUser } from './user-stats';

const CARMEN_FILE = path.join(process.cwd(), 'data', 'carmen-state.json');

interface CarmenState {
  active: boolean;
  story: string;
  realLocation: string; // Discord channel ID
  decoyLocations: string[]; // Discord channel IDs
  clues: Record<string, string>; // channelId -> clue text
  foundBy: string[]; // usernames who found real Carmen
  traitors: string[]; // usernames helping Carmen
  accusations: Record<string, string>; // accuser -> accused
  startTime: number;
  timeLimit: number; // minutes
}

let carmenState: CarmenState = {
  active: false,
  story: '',
  realLocation: '',
  decoyLocations: [],
  clues: {},
  foundBy: [],
  traitors: [],
  accusations: {},
  startTime: 0,
  timeLimit: 15
};

function loadCarmen(): CarmenState {
  if (!fs.existsSync(CARMEN_FILE)) {
    return carmenState;
  }
  return JSON.parse(fs.readFileSync(CARMEN_FILE, 'utf-8'));
}

function saveCarmen() {
  fs.mkdirSync(path.dirname(CARMEN_FILE), { recursive: true });
  fs.writeFileSync(CARMEN_FILE, JSON.stringify(carmenState, null, 2));
}

export async function startCarmenGame(channels: string[], story: string, clues: Record<string, string>) {
  if (channels.length < 3) {
    throw new Error('Need at least 3 Discord channels for Carmen game');
  }

  // Pick 1 real location, 2 decoys
  const shuffled = [...channels].sort(() => Math.random() - 0.5);
  const realLocation = shuffled[0];
  const decoyLocations = shuffled.slice(1, 3);

  carmenState = {
    active: true,
    story,
    realLocation,
    decoyLocations,
    clues,
    foundBy: [],
    traitors: [],
    accusations: {},
    startTime: Date.now(),
    timeLimit: 15
  };
  saveCarmen();

  // Post Carmen embeds to Discord
  await postCarmenEmbed(realLocation, true);
  for (const decoy of decoyLocations) {
    await postCarmenEmbed(decoy, false);
  }

  // Announce in Twitch chat
  await sendChatMessage(`🕵️ CARMEN SANDIEGO GAME STARTED! ${story} Use !search #channel to investigate!`, 'bot');
}

async function postCarmenEmbed(channelId: string, isReal: boolean) {
  const message = isReal
    ? 'Carmen is here. Choose whether to report her or help her escape.'
    : 'This looks like Carmen, but something feels off.';
  await sendDiscordMessage(channelId, message);
}

export async function handleCarmenButton(userId: string, username: string, buttonId: string, channelId: string) {
  carmenState = loadCarmen();

  if (!carmenState.active) {
    return { ephemeral: true, content: 'No Carmen game is active!' };
  }

  // Real Carmen - Report
  if (buttonId === 'carmen_report' && channelId === carmenState.realLocation) {
    carmenState.foundBy.push(username);
    saveCarmen();
    
    const user = await getUser(username);
    await updateUser(username, { points: user.points + 500 });
    
    await sendChatMessage(`🎉 @${username} found Carmen and reported her! +500 pts`, 'bot');
    await endCarmenGame(false);
    
    return { ephemeral: true, content: '✅ You reported Carmen! +500 points!' };
  }

  // Real Carmen - Help (BETRAYAL)
  if (buttonId === 'carmen_help' && channelId === carmenState.realLocation) {
    carmenState.traitors.push(username);
    saveCarmen();
    
    return {
      ephemeral: true,
      content: `🤫 Carmen whispers: "Help me escape and I'll give you 800 points! Post a FAKE clue in Twitch chat to mislead others. Use: !fakeclue #channel-name your-fake-clue"\n\nIf I escape (timer runs out), you win big. If caught, you lose 200 pts. Choose wisely...`
    };
  }

  // Decoy Carmen
  if (buttonId === 'carmen_decoy' && carmenState.decoyLocations.includes(channelId)) {
    const isLucky = Math.random() > 0.5;
    
    if (isLucky) {
      const user = await getUser(username);
      await updateUser(username, { points: user.points + 50 });
      await sendChatMessage(`@${username} found a decoy Carmen! +50 consolation pts`, 'bot');
      return { ephemeral: true, content: '🎭 This was a decoy! Carmen left you 50 points as a consolation prize.' };
    } else {
      const user = await getUser(username);
      await updateUser(username, { points: user.points - 100 });
      await sendChatMessage(`@${username} fell for Carmen's trap! -100 pts`, 'bot');
      return {
        ephemeral: true,
        content: "TRAP! You fell for a decoy and Carmen knows you're looking for her. -100 points!",
      };
    }
  }

  return { ephemeral: true, content: 'Something went wrong...' };
}

export async function handleFakeClue(username: string, fakeClue: string) {
  carmenState = loadCarmen();

  if (!carmenState.traitors.includes(username)) {
    await sendChatMessage(`@${username}, you're not helping Carmen!`, 'bot');
    return;
  }

  // Post fake clue
  await sendChatMessage(`🔍 Clue found: ${fakeClue}`, 'bot');
  
  const user = await getUser(username);
  await updateUser(username, { points: user.points + 100 });
  
  await sendChatMessage(`@${username} shared a clue! +100 pts`, 'bot');
}

export async function handleAccusation(accuser: string, accused: string) {
  carmenState = loadCarmen();

  if (!carmenState.active) {
    await sendChatMessage(`@${accuser}, no Carmen game is active!`, 'bot');
    return;
  }

  const isTraitor = carmenState.traitors.includes(accused);
  
  if (isTraitor) {
    const accuserUser = await getUser(accuser);
    await updateUser(accuser, { points: accuserUser.points + 200 });
    
    const traitorUser = await getUser(accused);
    await updateUser(accused, { points: traitorUser.points - 200 });
    
    await sendChatMessage(`🎯 @${accuser} correctly accused @${accused} of helping Carmen! +200 pts to accuser, -200 to traitor!`, 'bot');
  } else {
    const accuserUser = await getUser(accuser);
    await updateUser(accuser, { points: accuserUser.points - 100 });
    
    await sendChatMessage(`❌ @${accuser} falsely accused @${accused}! -100 pts for false accusation!`, 'bot');
  }
}

async function endCarmenGame(escaped: boolean) {
  if (escaped) {
    // Carmen escaped - traitors win
    for (const traitor of carmenState.traitors) {
      const user = await getUser(traitor);
      await updateUser(traitor, { points: user.points + 500 });
    }
    await sendChatMessage(`🏃 Carmen escaped! Traitors win: ${carmenState.traitors.join(', ')} +500 pts each!`, 'bot');
  } else {
    // Carmen caught - traitors lose
    for (const traitor of carmenState.traitors) {
      const user = await getUser(traitor);
      await updateUser(traitor, { points: user.points - 200 });
    }
    await sendChatMessage(`🚔 Carmen was caught! Traitors exposed: ${carmenState.traitors.join(', ')} -200 pts each!`, 'bot');
  }

  carmenState.active = false;
  saveCarmen();
}

// Timer check (call periodically)
export function checkCarmenTimer() {
  carmenState = loadCarmen();
  
  if (!carmenState.active) return;
  
  const elapsed = (Date.now() - carmenState.startTime) / 1000 / 60; // minutes
  
  if (elapsed >= carmenState.timeLimit) {
    endCarmenGame(true); // Carmen escaped
  }
}

// Initialize
carmenState = loadCarmen();
