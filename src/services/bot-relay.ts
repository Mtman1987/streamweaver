import type { WorldLoreCharacter } from '@/lib/world-lore-store';
import { generateAIResponse } from '@/services/ai-provider';

export type BotRelayRequest = {
  matched: boolean;
  target?: WorldLoreCharacter;
  targetName?: string;
  relayMessage?: string;
  source?: 'parser' | 'ai';
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function characterNames(character: WorldLoreCharacter): string[] {
  return Array.from(new Set([
    character.currentName,
    ...(character.aliases || []),
    ...(character.previousNames || []),
  ].map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeRelayText(message: string, speakerName?: string): string {
  let normalized = String(message || '').trim();
  if (!normalized) return normalized;

  if (speakerName) {
    const speakerPattern = new RegExp(`^@?${escapeRegex(speakerName)}[,:\\-\\s]+`, 'i');
    normalized = normalized.replace(speakerPattern, '').trim();
  }

  return normalized;
}

function extractQuotedRelayMessage(message: string): string {
  const match = String(message || '').match(/"([^"]+)"|'([^']+)'|\u201c([^\u201d]+)\u201d|\u2018([^\u2019]+)\u2019/);
  return String(match?.[1] || match?.[2] || match?.[3] || match?.[4] || '').trim();
}

function relationshipTarget(normalized: string, speakerName: string | undefined, targets: WorldLoreCharacter[]): WorldLoreCharacter | null {
  const speaker = String(speakerName || '').trim().toLowerCase();
  if (!speaker || !/\byour\s+sister\b|\bsister\b/i.test(normalized)) return null;
  if (!['athena', 'annie', 'athenabot87'].includes(speaker)) return null;
  return targets.find((target) =>
    (target.relationshipIds || []).some((id) => String(id).toLowerCase().includes('sister'))
    || characterNames(target).some((name) => name.toLowerCase() === 'scarlett')
  ) || null;
}

function nestedRelayToHandle(normalized: string): BotRelayRequest | null {
  const quoted = extractQuotedRelayMessage(normalized);
  const match = normalized.match(/\b(?:pass|send|relay)\s+(?:a\s+)?message\s+to\s+@?([a-z0-9_][a-z0-9_-]{1,49})\b(?:\s+that)?[\s,:-]*(.+)?$/i);
  const targetName = String(match?.[1] || '').trim();
  const relayMessage = (quoted || String(match?.[2] || '').trim().replace(/^that\s+/i, '')).trim();
  if (!targetName || !relayMessage) return null;
  return {
    matched: true,
    targetName,
    relayMessage,
    source: 'parser',
  };
}

const GENERIC_TARGET_STOP_WORDS = new Set([
  'your',
  'my',
  'his',
  'her',
  'their',
  'our',
  'the',
  'a',
  'an',
  'this',
  'that',
]);

export function detectBotRelayRequest(input: {
  message: string;
  speakerName?: string;
  targets: WorldLoreCharacter[];
}): BotRelayRequest {
  const normalized = normalizeRelayText(input.message, input.speakerName);
  if (!normalized) return { matched: false };

  const relayVerbs = '(?:tell|ask|message|dm|relay|notify|let\\s+[^\\s]+\\s+know|send\\s+(?:a\\s+)?message\\s+to)';

  const nested = nestedRelayToHandle(normalized);
  if (nested) return nested;

  const relatedTarget = relationshipTarget(normalized, input.speakerName, input.targets);
  if (relatedTarget) {
    const relationshipPattern = new RegExp(`\\b(?:can you|could you|would you|please)?\\s*${relayVerbs}\\s+(?:your\\s+)?sister\\b(?:\\s+that)?[\\s,:-]*(.+)$`, 'i');
    const match = normalized.match(relationshipPattern);
    const relayMessage = String(match?.[1] || '').trim().replace(/^that\s+/i, '');
    if (relayMessage) {
      return {
        matched: true,
        target: relatedTarget,
        targetName: relatedTarget.currentName,
        relayMessage,
        source: 'parser',
      };
    }
  }

  for (const target of input.targets) {
    for (const name of characterNames(target)) {
      const escaped = escapeRegex(name);
      const patterns = [
        new RegExp(`\\b(?:can you|could you|would you|please)?\\s*${relayVerbs}\\s+@?${escaped}\\b(?:\\s+that)?[\\s,:-]*(.+)$`, 'i'),
        new RegExp(`\\b@?${escaped}\\b[\\s,:-]+(?:can you|could you|would you|please)?\\s*${relayVerbs}[\\s,:-]*(.+)$`, 'i'),
      ];

      for (const pattern of patterns) {
        const match = normalized.match(pattern);
        const relayMessage = String(match?.[1] || '').trim().replace(/^that\s+/i, '');
        if (relayMessage) {
          return {
            matched: true,
            target,
            targetName: name,
            relayMessage,
            source: 'parser',
          };
        }
      }
    }
  }

  const genericTargetSuffix = `(?:\\s*(?:'s|\\u2019s)\\s*(?:bot|stream|channel)|\\s+(?:bot|stream|channel))?`;
  const genericPattern = new RegExp(`\\b(?:can you|could you|would you|please)?\\s*(?:tell|ask|message|dm|relay|notify|send\\s+(?:a\\s+)?message\\s+to)\\s+@?([a-z0-9_][a-z0-9_-]{1,49})\\b${genericTargetSuffix}(?:\\s+that)?[\\s,:-]*(.+)$`, 'i');
  const genericMatch = normalized.match(genericPattern);
  const genericTarget = String(genericMatch?.[1] || '').trim();
  const genericRelayMessage = String(genericMatch?.[2] || '').trim().replace(/^that\s+/i, '');
  if (genericTarget && genericRelayMessage) {
    if (GENERIC_TARGET_STOP_WORDS.has(genericTarget.toLowerCase())) {
      return { matched: false };
    }
    return {
      matched: true,
      targetName: genericTarget,
      relayMessage: genericRelayMessage,
      source: 'parser',
    };
  }

  return { matched: false };
}

function relayCandidateText(message: string, speakerName?: string): string {
  return normalizeRelayText(message, speakerName).slice(0, 1000);
}

function targetCatalog(targets: WorldLoreCharacter[]): string {
  return targets
    .map((target) => {
      const names = characterNames(target);
      return `- ${target.currentName}${names.length > 1 ? ` (${names.slice(1).join(', ')})` : ''}`;
    })
    .slice(0, 40)
    .join('\n');
}

function extractJsonObject(text: string): any | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cleanRelayValue(value: unknown, maxLength: number): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

export async function detectBotRelayRequestWithAi(input: {
  message: string;
  speakerName?: string;
  targets: WorldLoreCharacter[];
  tenantId?: string;
  platform?: 'twitch' | 'discord';
}): Promise<BotRelayRequest> {
  const parsed = detectBotRelayRequest(input);
  if (parsed.matched) return parsed;

  const normalized = relayCandidateText(input.message, input.speakerName);
  if (!normalized) return { matched: false };

  try {
    const response = await generateAIResponse(
      [
        `Speaker bot: ${input.speakerName || 'unknown'}`,
        `Platform: ${input.platform || 'unknown'}`,
        input.targets.length ? `Known bot names:\n${targetCatalog(input.targets)}` : 'Known bot names: none loaded',
        `Human message: ${normalized}`,
        '',
        'Return JSON only with this shape:',
        '{"relay":true|false,"targetName":"streamer or bot to deliver to","relayMessage":"message to pass along","confidence":0.0}',
      ].join('\n'),
      [
        'You classify whether a human is asking one bot to pass a message to another streamer, channel, or bot.',
        'Return relay=true only when the human clearly wants delivery to another destination.',
        'The targetName may be a Twitch username, streamer name, bot name, or phrase like "nephalem2" from "nephalem2\'s bot".',
        'The relayMessage is the content to pass along, preserving quoted text exactly when quotes are present.',
        'Do not classify normal chat, translation requests, shoutout requests, or questions about how to use relays as relay=true.',
        'Return JSON only. No prose.',
      ].join(' '),
      input.tenantId,
      { maxTokens: 180, temperature: 0 }
    );
    const json = extractJsonObject(response);
    const confidence = Number(json?.confidence || 0);
    const targetName = cleanRelayValue(json?.targetName, 80).replace(/^@/, '');
    const relayMessage = cleanRelayValue(json?.relayMessage, 500);
    if (json?.relay === true && confidence >= 0.65 && targetName && relayMessage) {
      return {
        matched: true,
        targetName,
        relayMessage,
        source: 'ai',
      };
    }
  } catch (error) {
    console.warn('[BotRelay] AI relay intent classification failed:', error);
  }

  return { matched: false };
}
