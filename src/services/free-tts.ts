import { readAICostPolicy } from './ai-cost-policy';

let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
let unavailableUntil = 0;

const FREE_KOKORO_VOICES = ['af_heart', 'af_bella', 'am_michael'] as const;
const FREE_TTS_ATTEMPT_TIMEOUT_MS = 12_000;

function resolveFreeWorkerBase(): URL | null {
  const configured = readAICostPolicy().speechWorkerUrl;
  try {
    const base = new URL(configured);
    if (base.protocol === 'http:' && base.hostname === '127.0.0.1' && base.port === '8080' && !base.username && !base.password) {
      return base;
    }
  } catch {
    // Fall through to the safe in-process worker address below.
  }

  // Older persisted policies used the retired private Fly hostname. The free
  // worker now runs beside the Next process, so stale policy must not disable
  // every free voice request. Never honor an arbitrary remote URL here.
  console.warn('[TTS] Ignoring stale/unsafe speechWorkerUrl; using local Kokoro worker.');
  return new URL('http://127.0.0.1:8080');
}

export async function generateFreeTTS(text: string, voice: string, strictVoice = false): Promise<string> {
  // Serialize CPU inference, bound queue and latency, and never retry a broken
  // worker on every chat message. No paid route is consulted here.
  if (Date.now() < unavailableUntil || pending >= 8) return '';
  const enqueuedAt = Date.now();
  pending++;
  const task = queue.then(async () => {
    if (Date.now() < unavailableUntil || Date.now() - enqueuedAt > 45_000) return '';
    const base = resolveFreeWorkerBase();
    if (!base) return '';

    // A timeout on the preferred voice must not immediately disable speech.
    // Try the other free Kokoro voices before opening the short worker cooldown.
    const voices = strictVoice ? [voice] : [voice, ...FREE_KOKORO_VOICES.filter((candidate) => candidate !== voice)];
    const failures: string[] = [];
    for (const candidate of voices) {
      try {
        const response = await fetch(new URL('/v1/audio/speech', base), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: text.slice(0, 2000), voice: candidate }),
          signal: AbortSignal.timeout(FREE_TTS_ATTEMPT_TIMEOUT_MS),
        });
        if (!response.ok || !String(response.headers.get('content-type')).startsWith('audio/wav')) {
          throw new Error(`HTTP ${response.status}: invalid free voice response`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 44 || bytes.subarray(0, 4).toString() !== 'RIFF') {
          throw new Error('Free voice worker returned invalid audio');
        }
        unavailableUntil = 0;
        if (candidate !== voice) {
          console.warn('[TTS] Preferred free voice failed; fallback voice succeeded.', {
            preferredVoice: voice, fallbackVoice: candidate,
          });
        }
        return `data:audio/wav;base64,${bytes.toString('base64')}`;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        failures.push(`${candidate}: ${err.name} ${err.message.slice(0, 160)}`);
        console.warn('[TTS] Free voice attempt failed; trying next free Kokoro voice.', {
          voice: candidate, errorName: err.name, errorMessage: err.message.slice(0, 200),
          remainingFallbacks: voices.length - failures.length,
        });
      }
    }

    unavailableUntil = Date.now() + 60_000;
    console.warn('[TTS] All free Kokoro voices failed; speech paused for 60 seconds.', {
      attempts: failures.length, failures,
    });
    return '';
  });
  queue = task.catch(() => undefined);
  try { return await task; } finally { pending--; }
}
