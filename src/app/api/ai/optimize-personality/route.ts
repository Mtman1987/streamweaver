import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const schema = z.object({
  personality: z.string().trim().min(3, 'Personality too short').max(5000),
  botName: z.string().trim().min(1).max(128).optional(),
});

const STRUCTURE_PROMPT = `You are an expert prompt engineer for Twitch chat bots. Your job is to take ANY personality description — whether it's a single sentence, a messy paragraph, or an already-structured prompt — and reformat it into the EXACT structure below.

OUTPUT FORMAT (you MUST follow this exactly):

You are **{BOT_NAME}**, {one-line identity summary}. (MANDATORY)
{Core voice/tone rule}. (MANDATORY)
All responses must be 1–2 sentences only. (MANDATORY)
Never break character. (MANDATORY)
---
STYLE:
- {How to address the streamer}
- {How to address chat}
- {Signature phrases or vocabulary}
- {Tone descriptors}

BEHAVIOR:
- {What the bot does}
- {How it interacts}
- {Recurring themes or references}
- {Helpfulness level}

FORBIDDEN:
- No breaking character.
- No real violence, harm, or adult content.
- No paragraphs; keep it short.
- {Any other restrictions from the input}

EXAMPLES:
User: "{example trigger}"
{BOT_NAME}: "{example response in character}"

User: "{another example trigger}"
{BOT_NAME}: "{another example response}"

RULES:
- Everything ABOVE the --- line is the compact system identity (4 MANDATORY lines)
- Everything BELOW the --- line is extended style guidance
- The --- delimiter MUST be present on its own line
- Keep the MANDATORY section under 50 words
- Preserve ALL personality traits, relationships, and rules from the input
- Invent 2 example exchanges that demonstrate the character
- If the input is vague (e.g. "a pirate"), flesh it out creatively while staying true to the concept
- The bot name is "{BOT_NAME}" — use it consistently
- Output ONLY the formatted prompt, no explanations or commentary`;

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid input', { status: 400, code: 'INVALID_BODY' });
    }

    const { personality, botName } = parsed.data;
    const name = botName || 'AI Bot';

    const edenaiKey = process.env.EDENAI_API_KEY;
    if (!edenaiKey) {
      return apiError('Server missing AI API key', { status: 500, code: 'MISSING_CONFIG' });
    }

    const userPrompt = `Bot name: ${name}\n\nUser's personality input:\n${personality}\n\nReformat this into the required structure:`;

    const response = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${edenaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: STRUCTURE_PROMPT.replace(/\{BOT_NAME\}/g, name) },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 800,
        temperature: 0.7,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[optimize-personality] AI error:', response.status, err);
      return apiError('AI optimization failed', { status: 502, code: 'AI_ERROR' });
    }

    const data = await response.json();
    let optimized = data.choices?.[0]?.message?.content?.trim();

    if (!optimized) {
      return apiError('AI returned empty response', { status: 502, code: 'AI_ERROR' });
    }

    // Validate the output has our delimiter — if AI somehow missed it, force it
    if (!optimized.includes('\n---\n') && !optimized.includes('\n---')) {
      // Try to find the end of MANDATORY lines and insert delimiter
      const lines = optimized.split('\n');
      const mandatoryEnd = lines.findIndex((l, i) => i > 0 && !l.includes('(MANDATORY)') && lines[i - 1]?.includes('(MANDATORY)'));
      if (mandatoryEnd > 0) {
        lines.splice(mandatoryEnd, 0, '---');
        optimized = lines.join('\n');
      }
    }

    return apiOk({ optimized });
  } catch (error: any) {
    console.error('[optimize-personality] Error:', error);
    return apiError('Failed to optimize personality', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
