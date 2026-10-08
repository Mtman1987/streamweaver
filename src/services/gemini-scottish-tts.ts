import { readAICostPolicy } from './ai-cost-policy';

export const SCOTTISH_VOICE_ID = 'gemini:charon:scottish';
const MODEL = 'gemini-2.5-flash-preview-tts';
const ACCENT = 'Read the transcript exactly in a natural adult male Scottish English accent. Warm, clear and conversational; avoid exaggeration or caricature. Do not read these instructions. Transcript:\n';
let pending = 0;
let queue: Promise<unknown> = Promise.resolve();
let cooldownUntil = 0;

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

export async function generateScottishTTS(text: string): Promise<string> {
  // This route is available only on the already verified free Gemini project.
  // It never enables paid routes or substitutes an unrelated accent.
  if (!readAICostPolicy().geminiFreeTierVerified) throw new Error('Gemini free tier has not been verified');
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('Gemini speech is not configured');
  if (Date.now() < cooldownUntil || pending >= 4) return '';
  const queuedAt = Date.now();
  pending++;
  const task = queue.then(async () => {
    if (Date.now() < cooldownUntil || Date.now() - queuedAt > 45_000) return '';
    // Re-check operational policy before spending any quota after queueing.
    if (!readAICostPolicy().geminiFreeTierVerified) return '';
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: ACCENT + text.slice(0, 2000) }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
        } },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      cooldownUntil = Date.now() + ([401, 403].includes(response.status) ? 6 * 60 * 60_000 : response.status === 429 ? 15 * 60_000 : 60_000);
      throw new Error('Gemini Scottish speech failed: ' + response.status);
    }
    const result = await response.json();
    const audio = result?.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData)?.inlineData;
    if (!audio?.data || !/^audio\/L16;.*rate=24000/i.test(String(audio.mimeType))) throw new Error('Gemini returned no supported speech audio');
    const wav = pcmToWav(Buffer.from(audio.data, 'base64'));
    return 'data:audio/wav;base64,' + wav.toString('base64');
  });
  queue = task.catch(() => undefined);
  try { return await task; }
  catch (error) { cooldownUntil = Math.max(cooldownUntil, Date.now() + 60_000); throw error; }
  finally { pending--; }
}
