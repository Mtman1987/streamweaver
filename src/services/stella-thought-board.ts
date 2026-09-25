export type StellaEnergy = 'quiet' | 'conversational' | 'playful' | 'excited';

export type StellaThought = {
  at: number;
  kind: 'event' | 'conversation' | 'plan' | 'callback' | 'producer';
  text: string;
  actor?: string;
  expiresAt: number;
};

type Thread = { user: string; prompt: string; openedAt: number; expiresAt: number };

const thoughts: StellaThought[] = [];
const threads = new Map<string, Thread>();
let energy: StellaEnergy = 'conversational';
let streamerSpeakingUntil = 0;

function clean(now = Date.now()) {
  for (let i = thoughts.length - 1; i >= 0; i--) if (thoughts[i].expiresAt <= now) thoughts.splice(i, 1);
  for (const [key, value] of threads) if (value.expiresAt <= now) threads.delete(key);
  if (thoughts.length > 24) thoughts.splice(0, thoughts.length - 24);
}

export function rememberStellaThought(input: Omit<StellaThought, 'at' | 'expiresAt'> & { ttlMs?: number }, now = Date.now()) {
  clean(now);
  thoughts.push({ ...input, at: now, expiresAt: now + Math.max(30_000, input.ttlMs || 45 * 60_000) });
}

export function setStellaEnergy(next: StellaEnergy) { energy = next; }
export function getStellaEnergy(): StellaEnergy { return energy; }

export function noteStreamerSpeech(transcript: string, now = Date.now()) {
  const text = String(transcript || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) return;
  streamerSpeakingUntil = now + 8_000;
  rememberStellaThought({ kind: 'conversation', actor: 'M.T.', text: 'M.T. said: ' + text, ttlMs: 30 * 60_000 }, now);
}
export function isStreamerSpeaking(now = Date.now()) { return now < streamerSpeakingUntil; }

export function openStellaThread(user: string, prompt: string, now = Date.now()) {
  const key = user.toLowerCase().trim();
  if (!key) return;
  threads.set(key, { user, prompt: prompt.slice(0, 300), openedAt: now, expiresAt: now + 12 * 60_000 });
}
export function consumeStellaThread(user: string, now = Date.now()): Thread | null {
  clean(now);
  const key = user.toLowerCase().trim();
  const thread = threads.get(key) || null;
  if (thread) threads.delete(key);
  return thread;
}

export function stellaThoughtBoard(now = Date.now()) {
  clean(now);
  return {
    energy,
    streamerSpeaking: isStreamerSpeaking(now),
    recent: thoughts.slice(-10).map(({ kind, text, actor }) => ({ kind, text, actor })),
    openThreads: [...threads.values()].slice(-6).map(({ user, prompt }) => ({ user, prompt })),
  };
}

export function resetStellaThoughtBoard() {
  thoughts.splice(0);
  threads.clear();
  energy = 'conversational';
  streamerSpeakingUntil = 0;
}
