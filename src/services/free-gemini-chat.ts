import { createHash } from 'node:crypto';
import { readAICostPolicy } from './ai-cost-policy';

const MODEL = 'gemini-3.5-flash-lite';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';
type FailureCategory = 'not_configured' | 'busy' | 'quota' | 'authentication' | 'upstream' | 'empty_response' | 'blocked';
const cooldowns = new Map<string, { until: number; category: FailureCategory }>();
let active = 0;

// Only the operator-verified Fly credential may use the global free-tier policy.
function key(): string {
  return String(process.env.GEMINI_API_KEY || '').trim();
}
export function isFreeGeminiConfigured(tenantId?: string): boolean {
  return readAICostPolicy().geminiFreeTierVerified && Boolean(key());
}

export class FreeChatUnavailableError extends Error {
  readonly code = 'FREE_AI_UNAVAILABLE';
  constructor(readonly category: FailureCategory) {
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
  const apiKey = key();
  const fingerprint = createHash('sha256').update(apiKey).digest('hex');
  const cooldown = cooldowns.get(fingerprint);
  if (cooldown && cooldown.until > Date.now()) throw new FreeChatUnavailableError(cooldown.category);
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
            temperature: options.temperature !== undefined && Number.isFinite(Number(options.temperature))
              ? Math.max(0, Math.min(1, Number(options.temperature))) : 0.7,
          },
        }),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
    } catch {
      cooldowns.set(fingerprint, { until: Date.now() + 30_000, category: 'upstream' });
      throw new FreeChatUnavailableError('upstream');
    }
    if (!response.ok) {
      const authentication = response.status === 401 || response.status === 403;
      const category = authentication ? 'authentication' : response.status === 429 ? 'quota' : 'upstream';
      cooldowns.set(fingerprint, { until: Date.now() + (authentication ? 15 * 60_000 : 60_000), category });
      throw new FreeChatUnavailableError(category);
    }
    const data = await response.json().catch(() => ({}));
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.filter((p: any) => p?.thought !== true && typeof p?.text === 'string').map((p: any) => p.text).join('').trim() : '';
    if (!text) {
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (data?.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(finishReason)) {
        // A rejected turn must not disable the provider for every tenant.
        throw new FreeChatUnavailableError('blocked');
      }
      cooldowns.set(fingerprint, Date.now() + 30_000);
      throw new FreeChatUnavailableError('empty_response');
    }
    const limit = Math.max(1, Math.min(12_000, Math.floor(Number(options.maxCharacters) || 12_000)));
    return capAtCompleteSentence(text, limit);
  } finally { active--; }
}

function capAtCompleteSentence(text: string, limit: number): string {
  const value = String(text || '').trim();
  if (value.length <= limit) return value;

  const candidate = value.slice(0, limit);
  let sentenceEnd = -1;
  for (const match of candidate.matchAll(/[.!?](?:[\"')\]}]+)?(?=\s|$)/g)) {
    sentenceEnd = (match.index || 0) + match[0].length;
  }
  if (sentenceEnd >= Math.floor(limit * 0.6)) {
    return candidate.slice(0, sentenceEnd).trim();
  }
  return `${candidate.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

