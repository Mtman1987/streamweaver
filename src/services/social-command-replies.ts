import { getBotName, getBotPersonality } from '@/lib/bot-settings-store';
import { getInternalAppUrl } from '@/lib/runtime-origin';
import { readWorldLore, type WorldLoreCharacter } from '@/lib/world-lore-store';
import { internalServiceHeaders } from '@/lib/internal-service-auth';

export const SOCIAL_COMMAND_NAMES = [
  'hug', 'boop', 'cuddle', 'dance', 'fistbump', 'headpat', 'highfive', 'love', 'tickle', 'hover',
  'lurk', 'unlurk', 'yes', 'yup', 'no',
] as const;

type SocialCommandName = typeof SOCIAL_COMMAND_NAMES[number];

type GenerateSocialCommandReplyInput = {
  platform: 'discord' | 'twitch';
  commandName: string;
  userName: string;
  target?: string;
  tenantId?: string;
  botName?: string;
};

const TARGETED_SOCIAL_COMMANDS = new Set<SocialCommandName>([
  'hug', 'boop', 'cuddle', 'dance', 'fistbump', 'headpat', 'highfive', 'love', 'tickle',
]);

const SOCIAL_COMMAND_SET = new Set<string>(SOCIAL_COMMAND_NAMES);

export function isSocialCommandName(commandName: string): commandName is SocialCommandName {
  return SOCIAL_COMMAND_SET.has(String(commandName || '').toLowerCase());
}

function normalizeHandle(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/^@/, '');
}

function getSocialCommandFallback(input: {
  commandName: SocialCommandName;
  userName: string;
  target?: string;
}): string {
  const target = String(input.target || '').trim() || 'someone';
  const templates: Record<SocialCommandName, string> = {
    hug: `${input.userName} pulls ${target} into a hug.`,
    boop: `${input.userName} boops ${target} on the nose.`,
    cuddle: `${input.userName} curls up with ${target} for a cozy cuddle.`,
    dance: `${input.userName} breaks into a dance with ${target}.`,
    fistbump: `${input.userName} gives ${target} a solid fist bump.`,
    headpat: `${input.userName} gives ${target} a gentle headpat.`,
    highfive: `${input.userName} snaps a high-five with ${target}.`,
    love: `${input.userName} sends some love toward ${target}.`,
    tickle: `${input.userName} tries to tickle ${target}.`,
    hover: `${input.userName} hovers nearby like they have unfinished business.`,
    lurk: `${input.userName} slips quietly into lurk mode.`,
    unlurk: `${input.userName} steps back out of the shadows.`,
    yes: `Yes. ${input.userName} has spoken.`,
    yup: `Yup. ${input.userName} is locked in.`,
    no: `No. ${input.userName} is not approving that plan.`,
  };
  return templates[input.commandName];
}

async function getLoreCharacterForSpeaker(tenantId?: string, botName?: string): Promise<WorldLoreCharacter | null> {
  try {
    const lore = await readWorldLore();
    const characters = Object.values(lore?.characters || {});
    const tenantPrefix = tenantId ? `${tenantId}:` : '';
    const normalizedBotName = normalizeHandle(botName || '');

    return characters.find((character) => {
      if (tenantPrefix && !String(character.stableId || '').startsWith(tenantPrefix)) {
        return false;
      }
      const names = [
        character.currentName,
        ...(character.aliases || []),
        ...(character.previousNames || []),
      ].map(normalizeHandle).filter(Boolean);
      return normalizedBotName ? names.includes(normalizedBotName) : true;
    }) || null;
  } catch {
    return null;
  }
}

async function buildSpeakerPersonality(tenantId?: string, botName?: string): Promise<string> {
  const fallbackBotName = botName || getBotName(tenantId) || 'StreamWeaver';
  const basePersonality = getBotPersonality(tenantId);
  const loreCharacter = await getLoreCharacterForSpeaker(tenantId, fallbackBotName);

  return [
    `You are ${fallbackBotName}.`,
    basePersonality,
    loreCharacter?.archetype ? `Archetype: ${loreCharacter.archetype}.` : '',
    loreCharacter?.summary || '',
    loreCharacter?.personalityNotes?.length ? loreCharacter.personalityNotes.join(' ') : '',
    'Reply in one vivid sentence. Stay in character. Do not use quotes, labels, or emojis unless they are essential to that character.',
  ].filter(Boolean).join('\n');
}

const SOCIAL_COMMAND_STYLE: Record<SocialCommandName, string> = {
  hug: 'Warm and comforting. Describe an imaginative hug without sounding romantic by default.',
  boop: 'Mischievous and playful. Make the boop feel surprising and specific.',
  cuddle: 'Cozy and wholesome. Create a soft scene without sexual language.',
  dance: 'Energetic and musical. Treat this as a short announcement; the full dance flow is handled separately.',
  fistbump: 'Confident and celebratory, with a punchy sense of teamwork.',
  headpat: 'Gentle praise and encouragement. Keep it respectful and wholesome.',
  highfive: 'Fast, triumphant, and celebratory.',
  love: 'Wholesome appreciation. Make the affection feel personal without inventing private facts.',
  tickle: 'Silly and chaotic, but never threatening or sexual.',
  hover: 'The comic opposite of lurking: visibly present, suspiciously attentive, and making no effort to hide.',
  lurk: 'Playfully send the caller into quiet lurk mode while keeping their place in the community.',
  unlurk: 'Welcome the caller back from lurking with a fresh, character-specific observation.',
  yes: 'A brief affirmative reaction.',
  yup: 'A casual, confident affirmative reaction.',
  no: 'A brief but playful negative reaction.',
};

function buildSocialCommandPrompt(input: {
  commandName: SocialCommandName;
  userName: string;
  target?: string;
  platform: 'discord' | 'twitch';
  botName: string;
}): string {
  const target = String(input.target || '').trim();
  const hasTarget = TARGETED_SOCIAL_COMMANDS.has(input.commandName);
  const instruction = hasTarget
    ? `${input.userName} used !${input.commandName}${target ? ` on ${target}` : ''}. Write the bot's reaction to that action.`
    : `${input.userName} used !${input.commandName}. Write the bot's reaction to that command.`;

  return [
    `Command context: ${input.platform}.`,
    instruction,
    hasTarget
      ? 'Mention both people naturally when a target exists.'
      : 'Keep it directed at the room or the caller as appropriate.',
    SOCIAL_COMMAND_STYLE[input.commandName],
    'Never claim real-world knowledge about either person that was not provided.',
    'Keep it to one sentence and under 220 characters.',
    `The response should sound like ${input.botName}, not like a generic assistant.`,
  ].join('\n');
}

export async function generateSocialCommandReply(input: GenerateSocialCommandReplyInput): Promise<string | null> {
  const commandName = String(input.commandName || '').toLowerCase();
  if (!isSocialCommandName(commandName)) {
    return null;
  }

  const botName = input.botName || getBotName(input.tenantId) || 'StreamWeaver';
  const normalizedTarget = String(input.target || '').trim();
  const fallback = getSocialCommandFallback({
    commandName,
    userName: input.userName,
    target: normalizedTarget,
  });

  try {
    const personality = await buildSpeakerPersonality(input.tenantId, botName);
    const response = await fetch(`${getInternalAppUrl()}/api/ai/chat-with-memory`, {
      method: 'POST',
      headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username: input.userName,
        displayName: input.userName,
        message: buildSocialCommandPrompt({
          commandName,
          userName: input.userName,
          target: normalizedTarget,
          platform: input.platform,
          botName,
        }),
        personality,
        responseName: botName,
        tenantId: input.tenantId,
        context: input.platform === 'discord' ? 'discord' : 'twitch',
      }),
    });

    if (!response.ok) {
      console.warn('[SocialCommands] AI generation failed:', response.status, await response.text().catch(() => ''));
      return fallback;
    }

    const data = await response.json().catch(() => null) as { response?: string; data?: { response?: string } } | null;
    const reply = String(data?.response || data?.data?.response || '').trim();
    return reply || fallback;
  } catch (error) {
    console.warn('[SocialCommands] AI generation error:', error);
    return fallback;
  }
}
