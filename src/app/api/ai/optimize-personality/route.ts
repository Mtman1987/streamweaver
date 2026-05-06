import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const schema = z.object({
  personality: z.string().trim().min(10, 'Personality too short').max(5000),
  botName: z.string().trim().min(1).max(128).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid input', { status: 400, code: 'INVALID_BODY' });
    }

    const { personality, botName } = parsed.data;

    const edenaiKey = process.env.EDENAI_API_KEY;
    if (!edenaiKey) {
      return apiError('Server missing AI API key', { status: 500, code: 'MISSING_CONFIG' });
    }

    const metaPrompt = `You are an expert prompt engineer. Your task is to take a verbose bot personality description and compress it into the most compact, token-efficient system prompt possible that achieves ALL the same character goals, behaviors, relationships, and rules.

Rules for your output:
- Keep every behavioral rule, relationship dynamic, naming convention, and personality trait
- Remove redundancy, examples, and filler words
- Use shorthand and concise phrasing
- Do NOT add new behaviors or rules not in the original
- Output ONLY the optimized prompt text, nothing else
- The bot's name is "${botName || 'AI Bot'}" — keep that consistent
- Target under 300 tokens while preserving all intent

Original personality prompt:
---
${personality}
---

Optimized compact prompt:`;

    const response = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${edenaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You compress verbose prompts into minimal, token-efficient system prompts. Output only the optimized prompt.' },
          { role: 'user', content: metaPrompt },
        ],
        max_tokens: 500,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[optimize-personality] AI error:', response.status, err);
      return apiError('AI optimization failed', { status: 502, code: 'AI_ERROR' });
    }

    const data = await response.json();
    const optimized = data.choices?.[0]?.message?.content?.trim();

    if (!optimized) {
      return apiError('AI returned empty response', { status: 502, code: 'AI_ERROR' });
    }

    return apiOk({ optimized });
  } catch (error: any) {
    console.error('[optimize-personality] Error:', error);
    return apiError('Failed to optimize personality', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
