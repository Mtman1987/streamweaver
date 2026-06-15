import type { WorldLoreCharacter } from '@/lib/world-lore-store';

export type BotRelayRequest = {
  matched: boolean;
  target?: WorldLoreCharacter;
  targetName?: string;
  relayMessage?: string;
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

export function detectBotRelayRequest(input: {
  message: string;
  speakerName?: string;
  targets: WorldLoreCharacter[];
}): BotRelayRequest {
  const normalized = normalizeRelayText(input.message, input.speakerName);
  if (!normalized || !input.targets.length) return { matched: false };

  const relayVerbs = '(?:tell|ask|message|dm|relay|notify|let\\s+[^\\s]+\\s+know|send\\s+(?:a\\s+)?message\\s+to)';

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
          };
        }
      }
    }
  }

  const genericPattern = new RegExp(`\\b(?:can you|could you|would you|please)?\\s*(?:tell|ask|message|dm|relay|notify|send\\s+(?:a\\s+)?message\\s+to)\\s+@?([a-z0-9_][a-z0-9_-]{1,49})\\b(?:\\s+that)?[\\s,:-]*(.+)$`, 'i');
  const genericMatch = normalized.match(genericPattern);
  const genericTarget = String(genericMatch?.[1] || '').trim();
  const genericRelayMessage = String(genericMatch?.[2] || '').trim().replace(/^that\s+/i, '');
  if (genericTarget && genericRelayMessage) {
    return {
      matched: true,
      targetName: genericTarget,
      relayMessage: genericRelayMessage,
    };
  }

  return { matched: false };
}
