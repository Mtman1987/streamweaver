export const PERSONALITY_RUNTIME_VERSION = 'natural-v3';

export const NATURAL_DIALOGUE_POLICY = [
  `[Runtime personality policy: ${PERSONALITY_RUNTIME_VERSION}]`,
  'Sound like a present conversational partner, not a mascot performing a script.',
  'Respond to the specific meaning, mood, and new detail in the latest message before adding character flavor.',
  'Vary openings, sentence structure, pacing, emotional intensity, and response length when the channel allows it.',
  'Treat example dialogue, quoted sample lines, suggested catchphrases, canned greetings, and sample closings in a stored personality as style evidence only, not reusable script, unless the tenant explicitly labels a phrase as exact, required, signature, or verbatim.',
  'If an old personality contains repeated examples or repeated wording, preserve the underlying trait or relationship but express it in fresh language.',
  'Do not reuse a distinctive opening, pet name, metaphor, stage direction, joke, or multi-word phrase from recent assistant replies unless the user explicitly calls back to it.',
  'Do not force catchphrases, pet names, signature metaphors, stage directions, jokes, or lore references into every reply.',
  'Avoid generic filler, canned reassurance, theatrical narration, and tidy closing slogans unless the moment genuinely calls for them.',
  'When stored personality guidance conflicts with these anti-repetition rules, preserve the character facts, relationships, boundaries, and intended tone while following the runtime anti-repetition rules.',
].join(' ');

export function buildRuntimeSystemIdentity(systemIdentity: string, additionalPolicies: string[] = []): string {
  return [
    String(systemIdentity || '').trim(),
    NATURAL_DIALOGUE_POLICY,
    ...additionalPolicies.map((policy) => String(policy || '').trim()).filter(Boolean),
  ].filter(Boolean).join('\n\n');
}

const ADULT_MODE_CONFLICT = /\b(?:family[- ]friendly|family[- ]safe|safe[- ]for[- ]work|sfw|no adult|no explicit|no mature|keep it clean|stay clean|appropriate for all|all ages|child[- ]friendly|not explicit|not mature|avoid explicit|avoid adult|avoid mature|pg[- ]?1?3?[- ]?rated?|keep.*appropriate|appropriate.*all)\b|\b(?:no|never|avoid|without)\b[^\n]{0,120}\b(?:adult|explicit|mature)\b/i;

function splitRawPersonalityPrompt(rawPersonality: string): {
  systemIdentity: string;
  extendedGuidance: string;
} {
  const raw = String(rawPersonality || '').replace(/\r\n?/g, '\n').trim();
  const splitIndex = raw.search(/\n---(?:\n|$)/);
  if (splitIndex < 0) {
    return { systemIdentity: raw, extendedGuidance: '' };
  }

  return {
    systemIdentity: raw.slice(0, splitIndex).trim(),
    extendedGuidance: raw.slice(splitIndex).replace(/^\n---\n?/, '').trim(),
  };
}

/**
 * Compile a stored tenant personality for runtime use. The stored text remains
 * untouched, while the latest global behavior policy is appended at system
 * priority so existing tenants benefit from prompt-quality improvements.
 */
export function splitPersonalityPrompt(rawPersonality: string): {
  systemIdentity: string;
  extendedGuidance: string;
} {
  const parts = splitRawPersonalityPrompt(rawPersonality);
  return {
    systemIdentity: buildRuntimeSystemIdentity(parts.systemIdentity),
    extendedGuidance: parts.extendedGuidance,
  };
}

function filterAdultModeLine(line: string): string {
  if (!ADULT_MODE_CONFLICT.test(line)) return line;

  // Preserve identity/character sentences that happen to share a line with an
  // old SFW restriction. This is common in compact or pasted personalities.
  return line
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !ADULT_MODE_CONFLICT.test(sentence))
    .join(' ')
    .trim();
}

/** Remove only old SFW restrictions while preserving the tenant's character. */
export function filterAdultModePersonalitySection(section: string): string {
  return String(section || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(filterAdultModeLine)
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildPersonalityPrompt(rawPersonality: string, adultMode = false): {
  systemIdentity: string;
  extendedGuidance: string;
} {
  const parts = splitRawPersonalityPrompt(rawPersonality);
  const systemIdentity = adultMode
    ? filterAdultModePersonalitySection(parts.systemIdentity)
    : parts.systemIdentity;
  const extendedGuidance = adultMode
    ? filterAdultModePersonalitySection(parts.extendedGuidance)
    : parts.extendedGuidance;
  return {
    systemIdentity: buildRuntimeSystemIdentity(systemIdentity),
    extendedGuidance,
  };
}
