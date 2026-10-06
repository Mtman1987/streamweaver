import { readAICostPolicy } from './ai-cost-policy';

let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
let unavailableUntil = 0;

export async function generateFreeTTS(text: string, voice: string): Promise<string> {
  // Serialize CPU inference, bound queue and latency, and never retry a broken
  // worker on every chat message. No paid route is consulted here.
  if (Date.now() < unavailableUntil || pending >= 8) return '';
  const enqueuedAt = Date.now();
  pending++;
  const task = queue.then(async () => {
    if (Date.now() < unavailableUntil || Date.now() - enqueuedAt > 45_000) return '';
    try {
      const base = new URL(readAICostPolicy().speechWorkerUrl);
      if (base.protocol !== 'http:' || base.hostname !== 'spmt-free-tts.internal' || base.port !== '8080' || base.username || base.password) return '';
      const response = await fetch(new URL('/v1/audio/speech', base), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text.slice(0, 2000), voice }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok || !String(response.headers.get('content-type')).startsWith('audio/wav')) throw new Error('Free voice worker unavailable');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 44 || bytes.subarray(0, 4).toString() !== 'RIFF') throw new Error('Free voice worker returned invalid audio');
      unavailableUntil = 0;
      return `data:audio/wav;base64,${bytes.toString('base64')}`;
    } catch {
      unavailableUntil = Date.now() + 60_000;
      console.info('[TTS] Free voice worker is temporarily unavailable; speech skipped for 60 seconds.');
      return '';
    }
  });
  queue = task.catch(() => undefined);
  try { return await task; } finally { pending--; }
}
