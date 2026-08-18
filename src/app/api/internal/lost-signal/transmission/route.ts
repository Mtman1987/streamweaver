import { NextRequest } from 'next/server';
import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-response';
import { authorizeSpmtCoreService } from '@/lib/spmt-incoming-service-auth';
import { generateAIResponse } from '@/services/ai-provider';

const RequestSchema = z.object({
  wins: z.number().int().min(0).max(99).default(0),
  runSeed: z.string().trim().max(120).optional().default(''),
});

const PacketSchema = z.object({
  fragments: z.array(z.string().trim().min(2).max(80)).length(5),
  message: z.array(z.string().trim().min(1).max(180)).min(1).max(4),
});

function parsePacket(text: string) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Lost Signal AI returned no JSON object');
  const parsed = JSON.parse(cleaned.slice(first, last + 1));
  const validated = PacketSchema.safeParse(parsed);
  if (!validated.success) throw new Error('Lost Signal AI returned an invalid transmission packet');
  return validated.data;
}

const SYSTEM_PROMPT = `You generate fictional intercepted transmissions for a replayable science-fiction radio puzzle called THE LOST SIGNAL.

The game presents itself as ominous, dangerous, mysterious cosmic technology. The punchline is that after the player spends several minutes stabilizing an apparently critical deep-space transmission, the actual message is unexpectedly mundane, stupid, petty, bureaucratic, or ridiculous.

The joke comes from CONTRAST: serious cryptic setup -> completely unimpressive transmission.

RULES:
1. Create exactly 5 short radio fragments.
2. Each fragment must be 2-7 words and should sound alarming, cryptic, technical, or important.
3. The fragments must subtly foreshadow the final joke without revealing it.
4. Create a final decoded transmission of 1-4 short sentences.
5. The final transmission must be funny because it is dramatically less important than the buildup suggested.
6. Keep the humor PG-13 and suitable for a public community.
7. No sexual content, hate, harassment, politics, real-world tragedies, self-harm, graphic violence, or attacks on real people.
8. Do not use copyrighted characters or recognizable quotations.
9. Avoid current events and time-sensitive references.
10. Do not explain the joke and do not mention being an AI.
11. Do not use the spacecraft extended-warranty joke; that is reserved as a legacy fallback callback.
12. Favor wrong numbers, delivery notices, automated notices, petty arguments, cosmic bureaucracy, mundane emergencies, alien spam, accidental personal messages, or similarly ridiculous communication.
13. Keep every line concise enough to sound good through a robotic radio voice.

REPLAY PERSONALITY:
- previous wins 0-1: believable mundane interstellar spam or wrong-number transmissions.
- previous wins 2-4: stranger and more absurd.
- previous wins 5-8: bizarre bureaucracy, petty senders, or increasingly confused communications.
- previous wins 9+: occasionally let the sender seem vaguely aware that someone keeps intercepting these messages or that an absurd amount of effort was spent receiving them, but never mention game mechanics directly.

Return ONLY valid JSON in this exact schema:
{"fragments":["fragment one","fragment two","fragment three","fragment four","fragment five"],"message":["line one","optional line two","optional line three","optional line four"]}`;

export async function POST(request: NextRequest) {
  if (!(await authorizeSpmtCoreService(request, 'signal:generate'))) {
    return apiError('SPMT service authentication required', { status: 401, code: 'UNAUTHORIZED' });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid Lost Signal request', { status: 400, code: 'INVALID_BODY' });

  const { wins, runSeed } = parsed.data;
  const tenantId = String(process.env.SIGNAL_TWITCH_TENANT_ID || 'spacemountainlive').trim() || 'spacemountainlive';
  const prompt = [
    `PLAYER PREVIOUS WINS: ${wins}`,
    `RANDOM RUN SEED: ${runSeed || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    'Generate one fresh transmission packet now. Avoid repeating obvious stock jokes.',
  ].join('\n');

  try {
    const text = await generateAIResponse(prompt, SYSTEM_PROMPT, tenantId, {
      maxTokens: 360,
      temperature: 1.05,
    });
    const packet = parsePacket(text);
    return apiOk({ packet, source: 'ai' as const });
  } catch (error) {
    console.warn('[LostSignalAI] generation failed', error);
    return apiError('Lost Signal transmission generation unavailable', {
      status: 502,
      code: 'AI_GENERATION_FAILED',
    });
  }
}
