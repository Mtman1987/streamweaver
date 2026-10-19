import { readAICostPolicy } from './ai-cost-policy';

export const SCOTTISH_VOICE_ID = 'gemini:charon:scottish';
const MODEL = 'gemini-3.8-flash-tts';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const DEFAULT_SCOTTISH_STYLE = 'A natural adult male Scottish English accent. Warm, clear and conversational, with gentle pitch variation, human pacing and natural pauses. Keep the accent authentic rather than exaggerated. Never flat or robotic. Read the transcript exactly without adding words.';
let pending = 0;
let queue: Promise<unknown> = Promise.resolve();
let cooldownUntil = 0;

/** Compatibility helper for any callers that still need to wrap 24 kHz PCM. */
export function pcmToWav(pcm: Buffer): Buffer {
  if (!pcm.length || pcm.length % 2 || pcm.length > 10 * 1024 * 1024) throw new Error('Invalid Gemini speech audio');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function isWav(audio: Buffer): boolean {
  return audio.length >= 44 && audio.subarray(0, 4).toString() === 'RIFF' && audio.subarray(8, 12).toString() === 'WAVE';
}

function audioDataFromResponse(result: any): string {
  if (typeof result?.output_audio?.data === 'string') return result.output_audio.data;
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.type !== 'model_output' || !Array.isArray(step?.content)) continue;
    for (let j = step.content.length - 1; j >= 0; j--) {
      const part = step.content[j];
      if (part?.type === 'audio' && typeof part.data === 'string') return part.data;
    }
  }
  return '';
}

export async function generateScottishTTS(
  text: string,
  voice = 'Charon',
  style = DEFAULT_SCOTTISH_STYLE,
): Promise<string> {
  // Cloud TTS stays disabled until an operator explicitly verifies that this API key
  // is on a genuinely free-tier project. Local Kokoro remains the safe fallback.
  if (!readAICostPolicy().geminiFreeTierVerified) throw new Error('Gemini free tier has not been verified');
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('Gemini speech is not configured');
  if (Date.now() < cooldownUntil || pending >= 4) return '';
  const queuedAt = Date.now();
  pending++;
  const task = queue.then(async () => {
    if (Date.now() < cooldownUntil || Date.now() - queuedAt > 45_000) return '';
    if (!readAICostPolicy().geminiFreeTierVerified) return '';
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          model: MODEL,
          input: [{
            type: 'user_input',
            content: [{
              type: 'text',
              text: String(text || '').slice(0, 2000),
              annotations: [{ type: 'speech_metadata', style: String(style || DEFAULT_SCOTTISH_STYLE).slice(0, 600) }],
            }],
          }],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice: String(voice || 'Charon').slice(0, 64) }] },
        }),
        signal: AbortSignal.timeout(35_000),
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      cooldownUntil = Date.now() + 60_000;
      throw new Error('Gemini TTS request failed: ' + err.name);
    }
    if (!response.ok) {
      await response.text().catch(() => '');
      const status = response.status;
      cooldownUntil = Date.now() + ([401, 403].includes(status) ? 6 * 60 * 60_000 : status === 429 ? 15 * 60_000 : 60_000);
      console.warn('[Gemini TTS] upstream request failed', { model: MODEL, status });
      throw new Error('Gemini TTS failed: ' + status);
    }
    const result = await response.json().catch(() => ({}));
    const audioBase64 = audioDataFromResponse(result);
    if (!audioBase64) throw new Error('Gemini TTS returned no audio data');
    const wav = Buffer.from(audioBase64, 'base64');
    if (!isWav(wav)) throw new Error('Gemini TTS returned invalid WAV audio');
    if (wav.length > 30 * 1024 * 1024) throw new Error('Gemini TTS audio is too large');
    cooldownUntil = 0;
    return 'data:audio/wav;base64,' + wav.toString('base64');
  });
  queue = task.catch(() => undefined);
  try { return await task; }
  catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.warn('[Gemini TTS] generation failed; local Kokoro fallback is available', {
      errorName: err.name, errorMessage: err.message.slice(0, 220),
    });
    cooldownUntil = Math.max(cooldownUntil, Date.now() + 60_000);
    throw error;
  }
  finally { pending--; }
}
