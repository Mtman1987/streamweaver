import { promises as fs } from 'fs';
import path from 'path';
import { getBotName, getBotPersonality } from '@/lib/bot-settings-store';
import { readWorldLore, type WorldLoreCharacter } from '@/lib/world-lore-store';
import { tenantPath } from '@/lib/tenant';
import { generateAIResponse } from '@/services/ai-provider';

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

const SOCIAL_HISTORY_FILE = 'data/social-reaction-history.json';
type SocialReactionHistory = { sequence: number; replies: string[] };
const socialHistoryLocks = new Map<string, Promise<void>>();

function socialHistoryPath(tenantId?: string): string | null {
  const tenant = String(tenantId || '').trim();
  return tenant ? tenantPath(tenant, SOCIAL_HISTORY_FILE) : null;
}

async function readSocialHistory(tenantId?: string): Promise<SocialReactionHistory> {
  const filePath = socialHistoryPath(tenantId);
  if (!filePath) return { sequence: 0, replies: [] };
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<SocialReactionHistory>;
    return {
      sequence: Math.max(0, Math.floor(Number(raw.sequence || 0))),
      replies: Array.isArray(raw.replies)
        ? raw.replies.map((value) => String(value || '').trim()).filter(Boolean).slice(-80)
        : [],
    };
  } catch (error: any) {
    if (error?.code !== 'ENOENT') console.warn('[SocialCommands] Could not read reaction history:', error);
    return { sequence: 0, replies: [] };
  }
}

async function rememberSocialReply(tenantId: string | undefined, reply: string): Promise<void> {
  const filePath = socialHistoryPath(tenantId);
  if (!filePath || !reply.trim()) return;
  const tenant = String(tenantId);
  const previous = socialHistoryLocks.get(tenant) || Promise.resolve();
  const next = previous.then(async () => {
    const history = await readSocialHistory(tenant);
    const normalized = reply.trim();
    history.sequence += 1;
    if (!history.replies.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
      history.replies.push(normalized);
      history.replies = history.replies.slice(-80);
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(history, null, 2), 'utf8');
    await fs.rename(temp, filePath);
  }).catch((error) => console.warn('[SocialCommands] Could not persist reaction history:', error));
  socialHistoryLocks.set(tenant, next);
  await next;
  if (socialHistoryLocks.get(tenant) === next) socialHistoryLocks.delete(tenant);
}

function cleanSocialReply(value: unknown): string {
  return String(value || '').replace(/[\r\n\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function uniqueSocialFallback(input: { commandName: SocialCommandName; userName: string; target?: string }, sequence: number): string {
  const target = String(input.target || '').trim() || 'the Lounge';
  const action = input.commandName === 'fistbump' ? 'fist bump'
    : input.commandName === 'highfive' ? 'high five'
    : input.commandName === 'headpat' ? 'headpat'
    : input.commandName;
  const variants = [
    `${input.userName} just sent a ${action} toward ${target}; mission control logged the impact.`,
    `Zero gravity did absolutely nothing to stop ${input.userName}'s ${action} from reaching ${target}.`,
    `${target}, incoming: ${input.userName} just launched a ${action} across the Lounge.`,
    `Social telemetry spike: ${input.userName} → ${target}, classified as ${action}.`,
    `The Lounge sensors caught that ${action}; ${input.userName} has been officially noticed.`,
    `${input.userName} just turned a simple ${action} into a full orbital event for ${target}.`,
  ];
  const base = variants[Math.abs(sequence) % variants.length]!;
  return sequence < variants.length ? base : `${base} Starlog ${sequence + 1}.`;
}

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
  recentReplies?: string[];
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
    'This is a public stream interaction. Use no private memory or personal facts beyond the names and action supplied here.',
    'Never repeat an exact previous reaction. Change the opening, sentence shape, imagery, and punchline.',
    input.recentReplies?.length ? `Recent reactions that must not be repeated exactly: ${JSON.stringify(input.recentReplies.slice(-20))}` : '',
    `The response should sound like ${input.botName}, not like a generic assistant.`,
  ].join('\n');
}

export async function generateSocialCommandReply(input: GenerateSocialCommandReplyInput): Promise<string | null> {
  const commandName = String(input.commandName || '').toLowerCase();
  if (!isSocialCommandName(commandName)) return null;

  const botName = input.botName || getBotName(input.tenantId) || 'StreamWeaver';
  const normalizedTarget = String(input.target || '').trim();
  const history = await readSocialHistory(input.tenantId);
  const recentLower = new Set(history.replies.map((item) => item.toLowerCase()));
  const personality = await buildSpeakerPersonality(input.tenantId, botName);

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reply = cleanSocialReply(await generateAIResponse(
        buildSocialCommandPrompt({
          commandName,
          userName: input.userName,
          target: normalizedTarget,
          platform: input.platform,
          botName,
          recentReplies: history.replies,
        }) + (attempt ? '\nThe previous candidate repeated an earlier line. Produce a substantially different sentence now.' : ''),
        personality,
        input.tenantId,
        { maxTokens: 90, maxCharacters: 220, temperature: 1 },
      ));
      if (reply && !recentLower.has(reply.toLowerCase())) {
        await rememberSocialReply(input.tenantId, reply);
        return reply;
      }
    }
  } catch (error) {
    console.warn('[SocialCommands] AI generation error:', error);
  }

  let fallback = uniqueSocialFallback({ commandName, userName: input.userName, target: normalizedTarget }, history.sequence);
  let offset = 0;
  while (recentLower.has(fallback.toLowerCase()) && offset < 100) {
    offset += 1;
    fallback = uniqueSocialFallback({ commandName, userName: input.userName, target: normalizedTarget }, history.sequence + offset);
  }
  await rememberSocialReply(input.tenantId, fallback);
  return fallback;
}
