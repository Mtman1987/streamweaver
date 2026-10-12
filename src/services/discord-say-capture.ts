import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { transcribeAudio } from '@/services/speech';
const transcriptions = new Map<string, { expires: number; result: Promise<any> }>();
export async function discordSayCapture(userId: string, action: string, id?: string): Promise<any> {
  const secret = String(process.env.DSH_SERVICE_SECRET || process.env.DSH_CLIENT_SECRET || process.env.BOT_SECRET_KEY || '').trim();
  if (!secret) throw new Error('Discord listener service authentication is unavailable.');
  const configPath = 'data/runtime/discord-say.json';
  if (!existsSync(configPath)) {
    mkdirSync('data/runtime', { recursive: true });
    try { writeFileSync(configPath, JSON.stringify({ hubUrl: 'https://discord-stream-hub-new.fly.dev' }, null, 2), { flag: 'wx' }); }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  }
  const url = String(JSON.parse(readFileSync(configPath, 'utf8')).hubUrl || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(url)) throw new Error('Discord listener URL is missing from runtime configuration.');
  const response = await fetch(url + '/api/internal/say-voice', { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, action, id }), signal: AbortSignal.timeout(22_000), cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || 'Discord listener request failed.');
  if (action !== 'result' || data.status !== 'complete') return data;
  if (typeof data.base64Audio !== 'string' || data.base64Audio.length > 650000) throw new Error('Invalid Discord voice recording.');
  for (const [key, entry] of transcriptions) if (entry.expires < Date.now()) transcriptions.delete(key);
  const key = userId + ':' + id;
  if (!transcriptions.has(key)) {
    const result = transcribeAudio(data.base64Audio, { freeOnly: true }).then(value => {
      if (value.error) throw new Error(value.error);
      const transcript = String(value.transcription || '').trim();
      if (!transcript) throw new Error('No spoken words were found in your Discord voice recording.');
      return { id, status: 'complete', transcript };
    });
    transcriptions.set(key, { expires: Date.now() + 90_000, result });
  }
  return transcriptions.get(key)!.result;
}
