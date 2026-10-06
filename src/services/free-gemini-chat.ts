import { createHash } from 'node:crypto';
import { readAICostPolicy } from './ai-cost-policy';
import { readUserConfigSync } from '@/lib/user-config';

const MODEL = 'gemini-3.5-flash-lite';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';
const cooldowns = new Map<string, number>();
let active = 0;

function key(tenantId?: string): string {
  return String(process.env.GEMINI_API_KEY || readUserConfigSync(tenantId).GEMINI_API_KEY || '').trim();
}
export function isFreeGeminiConfigured(tenantId?: string): boolean {
  return readAICostPolicy().geminiFreeTierVerified && Boolean(key(tenantId));
}

export class FreeChatUnavailableError extends Error {
  readonly code = 'FREE_AI_UNAVAILABLE';
  constructor(readonly category: 'not_configured' | 'busy' | 'quota' | 'authentication' | 'upstream' | 'empty_response') {
    super('Free AI chat is unavailable (' + category + '). Paid providers remain disabled.');
    this.name = 'FreeChatUnavailableError';
  }
}

export async function generateFreeGeminiResponse(
  prompt: string,
  systemPrompt = '',
  tenantId?: string,
  options: { maxTokens?: number; temperature?: number; maxCharacters?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!isFreeGeminiConfigured(tenantId)) throw new FreeChatUnavailableError('not_configured');
  const apiKey = key(tenantId);
  const fingerprint = createHash('sha256').update(apiKey).digest('hex');
  if ((cooldowns.get(fingerprint) || 0) > Date.now()) throw new FreeChatUnavailableError('quota');
  cooldowns.delete(fingerprint);
  if (active >= 1) throw new FreeChatUnavailableError('busy');
  active++;
  try {
    let response: Response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          ...(systemPrompt.trim() ? { systemInstruction: { parts: [{ text: systemPrompt.slice(-12_000) }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: prompt.slice(-24_000) }] }],
          generationConfig: {
            maxOutputTokens: Math.max(32, Math.min(1200, Math.floor(Number(options.maxTokens) || 400))),
            temperature: Math.max(0, Math.min(1, Number(options.temperature) || 0.7)),
          },
        }),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
    } catch {
      cooldowns.set(fingerprint, Date.now() + 30_000);
      throw new FreeChatUnavailableError('upstream');
    }
    if (!response.ok) {
      const authentication = response.status === 401 || response.status === 403;
      cooldowns.set(fingerprint, Date.now() + (authentication ? 15 * 60_000 : 60_000));
      throw new FreeChatUnavailableError(authentication ? 'authentication' : response.status === 429 ? 'quota' : 'upstream');
    }
    const data = await response.json().catch(() => ({}));
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.filter((p: any) => p?.thought !== true && typeof p?.text === 'string').map((p: any) => p.text).join('').trim() : '';
    if (!text) {
      cooldowns.set(fingerprint, Date.now() + 30_000);
      throw new FreeChatUnavailableError('empty_response');
    }
    const limit = Math.max(1, Math.min(12_000, Math.floor(Number(options.maxCharacters) || 12_000)));
    return text.slice(0, limit);
  } finally { active--; }
}
