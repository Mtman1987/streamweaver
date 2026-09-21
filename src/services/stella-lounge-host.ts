import { generateAIResponse } from '@/services/ai-provider';
import { extractAvatarGesture } from '@/lib/avatar-gestures';
import { rememberAvatarGesture } from '@/lib/avatar-gesture-runtime';
import { appendPublicChatMessages } from '@/lib/public-chat-store';
import {
  SPACEMOUNTAIN_SYSTEM_BOT_NAME,
  SPACEMOUNTAIN_SYSTEM_BOT_PERSONALITY,
  SPACEMOUNTAIN_SYSTEM_TENANT_ID,
  SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL,
} from '@/lib/tenant';
import { tenantHasBotAccount } from '@/lib/bot-settings-store';
import { queueTtsOverlay } from '@/services/tts-overlay-queue';
import { hasActiveTtsConsumer } from '@/services/tts-consumer-presence';
import { sendChatMessage } from '@/services/twitch';

export type StellaLoungeIntent =
  | 'overview'
  | 'join-game'
  | 'game-status'
  | 'playing'
  | 'moderator'
  | 'fist-bump';

export type StellaLoungeSnapshot = {
  capturedAt: string;
  media: {
    available: boolean;
    currentTitle?: string;
    currentArtist?: string;
    queueCount: number;
    nextTitle?: string;
  };
  nebula: {
    available: boolean;
    playerCount: number;
    activePlayerCount: number;
    currentPlayer?: string;
    games: Array<{ name: string; joinCommand?: string }>;
  };
  community: {
    available: boolean;
    liveCount: number;
    liveNames: string[];
  };
};

type FetchLike = typeof fetch;

const SPMT_URL = (process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/+$/, '');
const NEBULA_URL = (
  process.env.NEBULA_ARCADE_BASE_URL
  || process.env.CHAT_TAG_BASE_URL
  || process.env.NEXT_PUBLIC_CHAT_TAG_URL
  || 'https://chat-tag-new.fly.dev'
).replace(/\/+$/, '');
const HEARMEOUT_URL = (
  process.env.HEARMEOUT_BASE_URL
  || process.env.NEXT_PUBLIC_HEARMEOUT_URL
  || 'https://hearmeout-main.fly.dev'
).replace(/\/+$/, '');

const SNAPSHOT_CACHE_MS = 15_000;
const AMBIENT_MIN_MS = 20 * 60_000;
const AMBIENT_MAX_MS = 45 * 60_000;

let cachedSnapshot: { expiresAt: number; value: StellaLoungeSnapshot } | null = null;
let ambientRunning = false;
let lastAmbientTopic = -1;
let nextAmbientAt = Date.now() + randomDelay(AMBIENT_MIN_MS, AMBIENT_MAX_MS);

function randomDelay(minimum: number, maximum: number): number {
  return minimum + Math.floor(Math.random() * Math.max(1, maximum - minimum + 1));
}

async function fetchJson(fetcher: FetchLike, url: string): Promise<any> {
  const response = await fetcher(url, {
    headers: { accept: 'application/json' },
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(5_000)
      : undefined,
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function unwrapData(payload: any): any {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

function liveCommunityRows(payload: any): any[] {
  const data = unwrapData(payload);
  if (Array.isArray(data?.liveMembers)) return data.liveMembers;
  const rows = [data?.shoutouts, data?.items, data?.rows, data?.community]
    .find((value) => Array.isArray(value)) || [];
  return rows.filter((row: any) => (
    row?.isLive === true
    || row?.live === true
    || String(row?.status || '').toLowerCase() === 'live'
  ));
}

function publicPlayerName(player: any): string {
  return String(
    player?.twitchDisplayName
    || player?.displayName
    || player?.twitchUsername
    || player?.username
    || player?.discordDisplayName
    || player?.name
    || player?.twitchLogin
    || player?.login
    || '',
  ).replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function buildStellaLoungeSnapshot(
  fetcher: FetchLike = fetch,
  now = Date.now(),
): Promise<StellaLoungeSnapshot> {
  if (fetcher === fetch && cachedSnapshot && cachedSnapshot.expiresAt > now) return cachedSnapshot.value;

  const [mediaResult, nebulaResult, gamesResult, communityResult] = await Promise.allSettled([
    fetchJson(fetcher, `${HEARMEOUT_URL}/api/music/session/state`),
    fetchJson(fetcher, `${SPMT_URL}/api/integrations/chat-tag/state`)
      .catch(() => fetchJson(fetcher, `${NEBULA_URL}/api/tag`)),
    fetchJson(fetcher, `${NEBULA_URL}/api/game-hub/channel?channel=${SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL}`),
    fetchJson(fetcher, `${SPMT_URL}/api/community/shoutouts`),
  ]);

  const mediaData = mediaResult.status === 'fulfilled' ? unwrapData(mediaResult.value) : null;
  const currentMedia = mediaData?.current && typeof mediaData.current === 'object' ? mediaData.current : null;
  const mediaQueue = Array.isArray(mediaData?.queue) ? mediaData.queue : [];

  const nebulaData = nebulaResult.status === 'fulfilled' ? unwrapData(nebulaResult.value) : null;
  const nebulaState = nebulaData?.state && typeof nebulaData.state === 'object' ? nebulaData.state : nebulaData;
  const players = Array.isArray(nebulaState?.players) ? nebulaState.players : [];
  const currentPlayer = String(nebulaState?.currentIt || '').trim()
    || publicPlayerName(players.find((player: any) => player?.isIt));

  const gamesData = gamesResult.status === 'fulfilled' ? unwrapData(gamesResult.value) : null;
  const games = (Array.isArray(gamesData?.games) ? gamesData.games : [])
    .map((game: any) => {
      const name = String(game?.shortName || game?.name || game?.id || '').trim();
      const playerCommands = Array.isArray(game?.playerCommands) ? game.playerCommands : [];
      const joinCommand = String(playerCommands[0]?.trigger || game?.commandKey || '').trim();
      return name ? { name, joinCommand: joinCommand || undefined } : null;
    })
    .filter(Boolean)
    .slice(0, 8) as Array<{ name: string; joinCommand?: string }>;

  const liveRows = communityResult.status === 'fulfilled' ? liveCommunityRows(communityResult.value) : [];
  const liveNames = liveRows.map(publicPlayerName).filter(Boolean).slice(0, 12);

  const snapshot: StellaLoungeSnapshot = {
    capturedAt: new Date(now).toISOString(),
    media: {
      available: mediaResult.status === 'fulfilled',
      currentTitle: currentMedia?.title ? String(currentMedia.title) : undefined,
      currentArtist: currentMedia?.artist ? String(currentMedia.artist) : undefined,
      queueCount: mediaQueue.length,
      nextTitle: mediaQueue[0]?.title ? String(mediaQueue[0].title) : undefined,
    },
    nebula: {
      available: nebulaResult.status === 'fulfilled' || gamesResult.status === 'fulfilled',
      playerCount: players.length,
      activePlayerCount: players.filter((player: any) => player?.isActive).length,
      currentPlayer: currentPlayer || undefined,
      games,
    },
    community: {
      available: communityResult.status === 'fulfilled',
      liveCount: liveRows.length,
      liveNames,
    },
  };

  if (fetcher === fetch) cachedSnapshot = { expiresAt: now + SNAPSHOT_CACHE_MS, value: snapshot };
  return snapshot;
}

export function detectStellaLoungeIntent(message: string): StellaLoungeIntent | null {
  const normalized = String(message || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  if (/\b(fist\s*bump|pound it|dap me|up top)\b/.test(normalized)) return 'fist-bump';
  if (/\b(get|find|call|contact|need|where(?:'s| is))\b.*\b(mod|moderator|staff|help desk|support)\b|\bneed help from (?:a )?human\b/.test(normalized)) return 'moderator';
  if (/\b(what(?:'s| is) playing|now playing|what song|what movie|what is queued|media status|music status)\b/.test(normalized)) return 'playing';
  if (/\b(how (?:do|can) i join|join (?:the )?(?:game|games|rotation)|how to play|let me play|put me in)\b/.test(normalized)) return 'join-game';
  if (/\b(game status|who(?:'s| is) playing|who has the tag|who(?:'s| is) it|how many players|is (?:a |the )?game active)\b/.test(normalized)) return 'game-status';
  if (/\b(what(?:'s| is) happening|what(?:'s| is) going on|lounge status|catch me up|what can i do (?:here|now)|what are we doing)\b/.test(normalized)) return 'overview';
  return null;
}

function mediaLine(snapshot: StellaLoungeSnapshot): string {
  if (!snapshot.media.available) return 'HearMeOut is not reporting its player state right now.';
  if (snapshot.media.currentTitle) {
    return `HearMeOut is playing ${snapshot.media.currentTitle}${snapshot.media.currentArtist ? ` by ${snapshot.media.currentArtist}` : ''}, with ${snapshot.media.queueCount} queued.`;
  }
  if (snapshot.media.nextTitle) return `HearMeOut is idle; ${snapshot.media.nextTitle} is next in the ${snapshot.media.queueCount}-item queue.`;
  return 'HearMeOut is idle and its queue is empty.';
}

function gameLine(snapshot: StellaLoungeSnapshot): string {
  if (!snapshot.nebula.available) return 'Nebula Arcade is not reporting live game state right now.';
  const catalog = snapshot.nebula.games.length
    ? ` Available now: ${snapshot.nebula.games.map((game) => game.name).join(', ')}.`
    : '';
  if (!snapshot.nebula.playerCount) return `Nebula Arcade is ready, but nobody is in the shared player pool yet.${catalog}`;
  const current = snapshot.nebula.currentPlayer ? ` ${snapshot.nebula.currentPlayer} currently has the active turn.` : '';
  return `Nebula Arcade has ${snapshot.nebula.playerCount} players, ${snapshot.nebula.activePlayerCount} active.${current}${catalog}`;
}

export async function resolveStellaLoungeIntent(
  intent: StellaLoungeIntent,
  fetcher: FetchLike = fetch,
): Promise<string> {
  if (intent === 'fist-bump') return 'Right here—fist bump accepted. Nicely done. [happy_gesture]';
  if (intent === 'moderator') return 'I can help get this in front of a human. Type !mtfixit, then briefly tell me what happened; I will route the report through the Lounge support flow.';

  const snapshot = await buildStellaLoungeSnapshot(fetcher);
  if (intent === 'playing') return mediaLine(snapshot);
  if (intent === 'game-status') return `${gameLine(snapshot)} Type spmt join if you want in.`;
  if (intent === 'join-game') {
    const gameCommand = snapshot.nebula.games.find((game) => game.joinCommand);
    const specific = gameCommand
      ? ` For ${gameCommand.name}, the displayed player command is ${gameCommand.joinCommand}.`
      : '';
    return `Type spmt join to enter the shared Nebula Arcade rotation; new players are added to the end.${specific} ${gameLine(snapshot)}`;
  }

  const community = snapshot.community.available
    ? snapshot.community.liveCount
      ? `${snapshot.community.liveCount} community streamer${snapshot.community.liveCount === 1 ? ' is' : 's are'} live${snapshot.community.liveNames.length ? `: ${snapshot.community.liveNames.join(', ')}` : ''}.`
      : 'No community streamers are live at this moment.'
    : 'The live-community board is temporarily unavailable.';
  return `${mediaLine(snapshot)} ${gameLine(snapshot)} ${community}`;
}

export function formatStellaLoungeContext(snapshot: StellaLoungeSnapshot): string {
  return [
    'Verified live Lounge state (use these facts; do not invent missing state):',
    `- ${mediaLine(snapshot)}`,
    `- ${gameLine(snapshot)}`,
    snapshot.community.available
      ? `- Community live count: ${snapshot.community.liveCount}${snapshot.community.liveNames.length ? ` (${snapshot.community.liveNames.join(', ')})` : ''}.`
      : '- Community live state is unavailable.',
    '- The universal Nebula Arcade join command is: spmt join.',
    '- The human support handoff begins with: !mtfixit.',
  ].join('\n');
}

const AMBIENT_TOPICS = [
  (snapshot: StellaLoungeSnapshot) => `Invite the room into a quick, fun conversation about books: a favorite book, a character they would bring aboard, or a fictional world worth visiting. Do not recommend a specific book unless asked. Live state: ${mediaLine(snapshot)}`,
  (snapshot: StellaLoungeSnapshot) => `Offer the room an enthusiastic fist bump or celebrate the simple fact that the Lounge is still flying. Keep it natural, not motivational-poster language. Live state: ${gameLine(snapshot)}`,
  (snapshot: StellaLoungeSnapshot) => `Ask one playful, answerable question that could spark chat without requiring personal information. It may involve space travel, games, music, movies, snacks, or strange human customs. Live state: ${mediaLine(snapshot)} ${gameLine(snapshot)}`,
  (snapshot: StellaLoungeSnapshot) => `Give a short invitation to join what is available right now. Mention spmt join only if it fits. Do not pretend a game is active when the state says otherwise. Live state: ${gameLine(snapshot)}`,
  (snapshot: StellaLoungeSnapshot) => `Make one dry, warm observation as Stella about tending a 24-hour community Lounge. You may acknowledge the current music or game state, but do not narrate an event that did not happen. Live state: ${mediaLine(snapshot)} ${gameLine(snapshot)}`,
  (snapshot: StellaLoungeSnapshot) => `Start a tiny social moment: a harmless this-or-that, a one-line curiosity, a compact space fact framed as conversation, or an invitation for someone to share a win from their day. Live state: ${mediaLine(snapshot)}`,
];

function chooseAmbientTopic(snapshot: StellaLoungeSnapshot): string {
  let index = Math.floor(Math.random() * AMBIENT_TOPICS.length);
  if (AMBIENT_TOPICS.length > 1 && index === lastAmbientTopic) index = (index + 1) % AMBIENT_TOPICS.length;
  lastAmbientTopic = index;
  return AMBIENT_TOPICS[index](snapshot);
}

function scheduleNextAmbient(now = Date.now()): void {
  nextAmbientAt = now + randomDelay(AMBIENT_MIN_MS, AMBIENT_MAX_MS);
}

export async function runStellaLoungeHostTick(now = Date.now()): Promise<{ delivered: boolean; reason: string }> {
  if (ambientRunning) return { delivered: false, reason: 'already-running' };
  if (now < nextAmbientAt) return { delivered: false, reason: 'not-due' };

  const canSpeak = hasActiveTtsConsumer(SPACEMOUNTAIN_SYSTEM_TENANT_ID);
  const canChat = tenantHasBotAccount(SPACEMOUNTAIN_SYSTEM_TENANT_ID);
  if (!canSpeak && !canChat) {
    nextAmbientAt = now + 5 * 60_000;
    return { delivered: false, reason: 'no-live-output' };
  }

  ambientRunning = true;
  scheduleNextAmbient(now);
  try {
    const snapshot = await buildStellaLoungeSnapshot();
    const prompt = [
      chooseAmbientTopic(snapshot),
      'Create one spontaneous Lounge-host line in one or two short spoken sentences.',
      'Sound present, interested, and specific—not like a generic engagement bot.',
      'Do not say you checked a system. Do not invent viewers, events, memories, scores, media, or failures.',
      'Do not start with "Hey everyone" and do not end every line with a question.',
      'You may add one allowed avatar gesture tag at the very end.',
    ].join('\n');
    const generated = await generateAIResponse(prompt, SPACEMOUNTAIN_SYSTEM_BOT_PERSONALITY, SPACEMOUNTAIN_SYSTEM_TENANT_ID, {
      maxTokens: 180,
      maxCharacters: 500,
      temperature: 0.85,
    });
    const withoutName = String(generated || '').replace(/^Stella:\s*/i, '').trim();
    const parsed = extractAvatarGesture(withoutName);
    const text = parsed.text.slice(0, 500).trim();
    if (!text) return { delivered: false, reason: 'empty-generation' };
    if (parsed.gesture) rememberAvatarGesture(SPACEMOUNTAIN_SYSTEM_TENANT_ID, text, parsed.gesture);

    let delivered = false;
    if (canSpeak) {
      const tts = await queueTtsOverlay(text, SPACEMOUNTAIN_SYSTEM_TENANT_ID);
      delivered ||= Boolean(tts.ok && tts.queued);
    }
    if (canChat) {
      await sendChatMessage(text, 'bot', SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL, SPACEMOUNTAIN_SYSTEM_TENANT_ID);
      delivered = true;
    }
    if (delivered) {
      await appendPublicChatMessages([{
        type: 'ai',
        username: SPACEMOUNTAIN_SYSTEM_BOT_NAME,
        message: text,
        timestamp: new Date(now).toISOString(),
      }], 100, SPACEMOUNTAIN_SYSTEM_TENANT_ID);
    }
    return { delivered, reason: delivered ? 'delivered' : 'output-declined' };
  } catch (error) {
    console.warn('[Stella Lounge Host] Ambient turn failed:', error);
    return { delivered: false, reason: 'failed' };
  } finally {
    ambientRunning = false;
  }
}

export function resetStellaLoungeHostForTests(now = Date.now()): void {
  cachedSnapshot = null;
  ambientRunning = false;
  lastAmbientTopic = -1;
  nextAmbientAt = now + AMBIENT_MIN_MS;
}
