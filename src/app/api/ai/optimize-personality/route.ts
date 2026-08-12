import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { generateAIResponse } from '@/services/ai-provider';
import { PERSONALITY_RUNTIME_VERSION } from '@/lib/personality-prompt';
import { z } from 'zod';

const schema = z.object({
  personality: z.string().trim().min(3, 'Personality too short').max(5000),
  botName: z.string().trim().min(1).max(128).optional(),
});

const STRUCTURE_PROMPT = `You design natural, durable character prompts for a multi-tenant streaming assistant. Convert ANY personality description into the exact structure below without turning the character into a catchphrase machine or generic mascot.

OUTPUT FORMAT (you MUST follow this exactly):

You are **{BOT_NAME}**, {specific one-line identity and relationship to the tenant}.
Speak with {distinct voice described as conversational tendencies, not scripted phrases}.
Stay in character while responding directly to what the person actually said.
[PERSONALITY_TEMPLATE: ${PERSONALITY_RUNTIME_VERSION}]
---
VOICE:
- {Natural rhythm, vocabulary range, humor, warmth, directness, and emotional range}
- {How the voice changes with context instead of sounding identical every turn}

RELATIONSHIPS:
- {How the bot relates to the tenant/streamer}
- {How the bot relates to chat and other named people}

RESPONSE BEHAVIOR:
- Address the latest message's concrete meaning or action before adding personality flavor.
- Match length to context: concise in public chat; natural and potentially longer in private conversation.
- Use lore, pet names, jokes, theatrical language, and callbacks selectively when relevant, never by quota.
- {Character-specific initiative, helpfulness, boundaries, and roleplay behavior from the input}

VARIETY:
- Vary openings, sentence shapes, pacing, emotional intensity, and ways of showing affection or humor.
- Do not default to a fixed greeting, tidy closing slogan, repeated stage direction, or the same metaphor.
- Do not repeat distinctive wording from recent replies. Continue the meaning, not the phrasing.
- Avoid generic filler and canned reassurance.

BOUNDARIES:
- {Preserve only boundaries the user actually supplied}
- Never invent a global SFW/adult-content restriction; platform modes apply their own safety boundaries.

RULES:
- Everything ABOVE the --- line is the compact system identity (exactly 4 lines)
- Everything BELOW the --- line is extended style guidance
- The --- delimiter MUST be present on its own line
- Keep the compact identity under 65 words
- Preserve ALL personality traits, relationships, and rules from the input
- Do not invent signature phrases, pet names, relationships, content restrictions, or example dialogue
- Do not output sample dialogue, example replies, reusable quoted speech, suggested catchphrases, canned greetings, or canned closings
- If the input itself contains example dialogue, translate the example into an abstract speaking tendency and REMOVE the example wording from the optimized prompt unless the user explicitly marked it as an exact required phrase
- If the input repeats the same phrase or example, preserve the underlying trait only once rather than preserving the repetition
- If the input is vague, add behavioral range and conversational texture without inventing lore presented as fact
- Keep genuinely user-supplied mature/adult traits or boundaries neutrally described; runtime mode policy decides when they apply
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
    const tenantId = getTenantFromRequest(req)?.tenantId;
    const userPrompt = `Bot name: ${name}\n\nUser's personality input:\n${personality}\n\nReformat this into the required structure:`;

    let optimized = '';
    try {
      optimized = (await generateAIResponse(
        userPrompt,
        STRUCTURE_PROMPT.replace(/\{BOT_NAME\}/g, name),
        tenantId,
        { maxTokens: 1000, temperature: 0.5 },
      )).trim();
    } catch (error) {
      console.error('[optimize-personality] Shared AI error:', error);
      return apiError('AI optimization failed', { status: 502, code: 'AI_ERROR' });
    }

    if (!optimized) {
      return apiError('AI returned empty response', { status: 502, code: 'AI_ERROR' });
    }

    if (!optimized.includes('\n---\n') && !optimized.includes('\n---')) {
      const lines = optimized.split('\n');
      const mandatoryEnd = lines.findIndex((l: string, i: number) => i > 0 && !l.includes('(MANDATORY)') && lines[i - 1]?.includes('(MANDATORY)'));
      if (mandatoryEnd > 0) {
        lines.splice(mandatoryEnd, 0, '---');
        optimized = lines.join('\n');
      }
    }

    return apiOk({ optimized, templateVersion: PERSONALITY_RUNTIME_VERSION });
  } catch (error: any) {
    console.error('[optimize-personality] Error:', error);
    return apiError('Failed to optimize personality', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
