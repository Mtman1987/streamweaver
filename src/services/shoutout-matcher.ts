const EDEN_MODEL = 'google/gemini-2.5-flash';

export function extractShoutoutRequestTarget(message: string): string | null {
  const input = String(message || '').trim();
  if (!input) return null;

  const wakeWordStripped = input.replace(/^(?:athena|@[a-z0-9_]+)[,\s]+/i, '');
  const target = '(@?[a-z0-9_]{2,25})';
  const patterns = [
    new RegExp(`^(?:please\\s+)?(?:shout\\s*out|shoutout)\\s+(?:(?:to|for)\\s+)?${target}\\b`, 'i'),
    new RegExp(`^(?:please\\s+)?(?:give|do|send|run|trigger|play|make)\\s+(?:a\\s+)?(?:shout\\s*out|shoutout)\\s+(?:(?:to|for)\\s+)?${target}\\b`, 'i'),
    new RegExp(`^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:give\\s+)?(?:a\\s+)?(?:shout\\s*out|shoutout)\\s+(?:(?:to|for)\\s+)?${target}\\b`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = wakeWordStripped.match(pattern);
    if (match?.[1]) return match[1].replace(/^@/, '');
  }

  return null;
}

function normalizeName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_]+/g, '');
}

function scoreLocalMatch(spokenName: string, candidate: string): number {
  const spoken = normalizeName(spokenName);
  const normalizedCandidate = normalizeName(candidate);
  if (!spoken || !normalizedCandidate) return 0;
  if (spoken === normalizedCandidate) return 1_000;
  if (normalizedCandidate.includes(spoken) || spoken.includes(normalizedCandidate)) return 750;

  const sharedPrefix = [...spoken].findIndex((char, index) => normalizedCandidate[index] !== char);
  if (sharedPrefix > 0) {
    return 300 + sharedPrefix;
  }

  let overlap = 0;
  for (const char of new Set(spoken)) {
    if (normalizedCandidate.includes(char)) overlap++;
  }

  return overlap * 10;
}

function pickLocalMatch(spokenName: string, chatters: string[]): string | null {
  const scored = chatters
    .map((candidate) => ({ candidate, score: scoreLocalMatch(spokenName, candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate));

  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].candidate;
}

async function pickEdenMatch(spokenName: string, chatters: string[]): Promise<string | null> {
  const apiKey = process.env.EDENAI_API_KEY;
  if (!apiKey || chatters.length === 0) return null;

  const prompt = [
    `Someone said "${spokenName}" in chat.`,
    'Pick the closest username from this list:',
    chatters.join(', '),
    'Reply with only the exact username. If nothing is a reasonable match, reply with "none".',
  ].join('\n');

  try {
    const response = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EDEN_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You match spoken usernames to a known list. Return only the exact username or none.',
          },
          { role: 'user', content: prompt },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      console.warn('[ShoutoutMatcher] EdenAI match failed:', response.status, await response.text().catch(() => ''));
      return null;
    }

    const data = await response.json().catch(() => null);
    const rawMatch = String(data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
    const match = normalizeName(rawMatch);
    if (!match || match === 'none') return null;

    return chatters.find((candidate) => normalizeName(candidate) === match) || null;
  } catch (error) {
    console.warn('[ShoutoutMatcher] EdenAI match error:', error);
    return null;
  }
}

export async function matchShoutoutTarget(spokenName: string, chatters: string[]): Promise<string | null> {
  const normalizedChatters = chatters
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (!normalizedChatters.length) return null;

  const localMatch = pickLocalMatch(spokenName, normalizedChatters);
  if (localMatch) return localMatch;

  const edenMatch = await pickEdenMatch(spokenName, normalizedChatters);
  if (edenMatch) return edenMatch;

  return pickLocalMatch(spokenName, normalizedChatters);
}
