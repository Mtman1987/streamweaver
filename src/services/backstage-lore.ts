import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import {
  getBotAliases,
  getBotInterests,
  getBotName,
  getBotPersonality,
} from '@/lib/bot-settings-store';
import {
  appendBackstageLoreMemory,
  readBotInteractionHistory,
  type BotInteractionPlatform,
} from '@/lib/bot-interactions-store';
import { globalPath, listTenants, tenantPath } from '@/lib/tenant';
import {
  appendWorldLoreJournalEntry,
  readWorldLore,
  type WorldLore,
  type WorldLoreCharacter,
} from '@/lib/world-lore-store';
import type { SharedChatEventV1 } from '@/contracts/shared-chat-event';
import { requestAthenaJson } from '@/services/athena-model';

export type BackstageLoreVisibility = 'public' | 'private';

export type BackstageLoreCandidate = {
  id: string;
  sourceTenantId: string;
  sourceEventId?: string;
  platform: BotInteractionPlatform;
  visibility: BackstageLoreVisibility;
  sourceUser: string;
  sourceBotName?: string;
  channelId?: string;
  text: string;
  responseText?: string;
  createdAt: string;
  attempts?: number;
  nextAttemptAt?: string;
};

export type BackstageBotProfile = {
  tenantId: string;
  botName: string;
  aliases: string[];
  personality: string;
  interests: string[];
  character: WorldLoreCharacter;
};

export type BackstageInterestMatch = {
  tenantId: string;
  tags: string[];
};

export type BackstageClassification = {
  shareable: boolean;
  memoryText: string;
  matches: BackstageInterestMatch[];
};

export type BackstageIdleScene = {
  memoryText: string;
  interestTags: string[];
};

export type BackstageLoreCycleOptions = {
  now?: Date;
  maxCandidates?: number;
  forceIdle?: boolean;
  classifyCandidate?: (
    candidate: BackstageLoreCandidate,
    source: BackstageBotProfile,
    targets: BackstageBotProfile[],
  ) => Promise<BackstageClassification>;
  generateIdleScene?: (
    source: BackstageBotProfile,
    target: BackstageBotProfile,
    relationship: string,
    interestTag: string,
  ) => Promise<BackstageIdleScene | null>;
};

type BackstageState = {
  lastObservedActivityAt?: string;
  lastIdleSceneAt?: string;
  idleCursor?: number;
  queueCursor?: number;
};

const MAX_QUEUE_SIZE = 500;
const MAX_ATTEMPTS = 4;
const DEFAULT_POLL_INTERVAL_MS = 45_000;
const DEFAULT_IDLE_INTERVAL_MS = 20 * 60_000;
const queuePath = (tenantId: string) => tenantPath(tenantId, 'data/backstage-lore/queue.json');
const statePath = () => globalPath('backstage-lore/state.json');
const lockPath = (name: string) => globalPath(`backstage-lore/${name}.lock`);

function parsePositiveInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function cleanText(value: unknown, max = 4_000): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parseBotInterestTags(value: unknown): string[] {
  return Array.from(new Set(String(value || '')
    .split(/[,;|\n]+/)
    .map((tag) => normalize(tag))
    .filter(Boolean)))
    .slice(0, 40);
}

function hashId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function queueLockName(tenantId: string): string {
  return `queue-${hashId('tenant', tenantId)}`;
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf-8');
  await fs.rename(temporaryPath, filePath);
}

async function acquireFileLock(name: string, timeoutMs = 3_000): Promise<() => Promise<void>> {
  const filePath = lockPath(name);
  await fs.mkdir(dirname(filePath), { recursive: true });
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const handle = await fs.open(filePath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return async () => {
        await handle.close().catch(() => undefined);
        await fs.unlink(filePath).catch(() => undefined);
      };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const stat = await fs.stat(filePath);
        if (Date.now() - stat.mtimeMs > 2 * 60_000) {
          await fs.unlink(filePath).catch(() => undefined);
          continue;
        }
      } catch {}
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
  throw new Error(`Timed out acquiring backstage lore lock ${name}`);
}

async function withFileLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const release = await acquireFileLock(name);
  try {
    return await operation();
  } finally {
    await release();
  }
}

async function readQueue(tenantId: string): Promise<BackstageLoreCandidate[]> {
  const queue = await readJson<BackstageLoreCandidate[]>(queuePath(tenantId), []);
  return Array.isArray(queue)
    ? queue.filter((candidate) => candidate?.sourceTenantId === tenantId)
    : [];
}

async function enqueueCandidate(candidate: BackstageLoreCandidate): Promise<void> {
  const tenantId = String(candidate.sourceTenantId || '').trim();
  if (!tenantId) throw new Error('Backstage lore candidate requires a source tenant.');
  await withFileLock(queueLockName(tenantId), async () => {
    const existing = await readQueue(tenantId);
    const next = [...existing.filter((entry) => entry.id !== candidate.id), candidate].slice(-MAX_QUEUE_SIZE);
    await writeJsonAtomic(queuePath(tenantId), next);
  });
  await withFileLock('state', async () => {
    const state = await readJson<BackstageState>(statePath(), {});
    state.lastObservedActivityAt = candidate.createdAt;
    await writeJsonAtomic(statePath(), state);
  }).catch(() => undefined);
}

async function takeReadyCandidate(tenantId: string, now: Date): Promise<BackstageLoreCandidate | null> {
  return withFileLock(queueLockName(tenantId), async () => {
    const existing = await readQueue(tenantId);
    const index = existing.findIndex((candidate) => {
      const retryAt = candidate.nextAttemptAt ? Date.parse(candidate.nextAttemptAt) : 0;
      return !retryAt || retryAt <= now.getTime();
    });
    if (index < 0) return null;
    const [candidate] = existing.splice(index, 1);
    await writeJsonAtomic(queuePath(tenantId), existing);
    return candidate || null;
  });
}

async function dequeueCandidates(maxCandidates: number, now: Date): Promise<BackstageLoreCandidate[]> {
  const tenantIds = (await listTenants())
    .filter((tenantId) => tenantId && !tenantId.startsWith('__kick_silent__'))
    .sort();
  if (!tenantIds.length) return [];

  const state = await readJson<BackstageState>(statePath(), {});
  const cursor = Math.max(0, Number(state.queueCursor || 0));
  const offset = cursor % tenantIds.length;
  const orderedTenants = [...tenantIds.slice(offset), ...tenantIds.slice(0, offset)];
  const ready: BackstageLoreCandidate[] = [];
  let madeProgress = true;

  while (ready.length < maxCandidates && madeProgress) {
    madeProgress = false;
    for (const tenantId of orderedTenants) {
      if (ready.length >= maxCandidates) break;
      const candidate = await takeReadyCandidate(tenantId, now);
      if (!candidate) continue;
      ready.push(candidate);
      madeProgress = true;
    }
  }

  await withFileLock('state', async () => {
    const nextState = await readJson<BackstageState>(statePath(), {});
    nextState.queueCursor = (offset + 1) % tenantIds.length;
    await writeJsonAtomic(statePath(), nextState);
  }).catch(() => undefined);
  return ready;
}

function isPublicSharedChatEvent(event: SharedChatEventV1): boolean {
  if (!event.routing.botReadable) return false;
  if (event.sender.roles.includes('bot')) return false;
  if (event.sourceId === 'discord:dm') return false;
  if (event.platform === 'discord' && !String(event.meta?.guildId || '').trim()) return false;
  if (event.meta?.self === true) return false;
  const text = cleanText(event.text);
  if (!text || text.startsWith('!') || text.startsWith('[')) return false;
  return ['message', 'action', 'reply', 'reward', 'donation', 'membership'].includes(event.type);
}

function interactionPlatform(platform: SharedChatEventV1['platform']): BotInteractionPlatform {
  if (platform === 'twitch' || platform === 'discord' || platform === 'kick' || platform === 'youtube' || platform === 'social-stream') {
    return platform;
  }
  return 'app';
}

export async function queueBackstageLoreEvent(event: SharedChatEventV1): Promise<boolean> {
  if (!isPublicSharedChatEvent(event)) return false;
  const candidate: BackstageLoreCandidate = {
    id: hashId('chat', event.dedupeKey),
    sourceTenantId: event.tenantId,
    sourceEventId: event.eventId,
    platform: interactionPlatform(event.platform),
    visibility: 'public',
    sourceUser: event.sender.displayName,
    sourceBotName: getBotName(event.tenantId),
    channelId: event.channelId,
    text: cleanText(event.text),
    createdAt: event.receivedTimestamp,
    attempts: 0,
  };
  await enqueueCandidate(candidate);
  startBackstageLoreScheduler();
  return true;
}

export async function queueBackstageConversationTurn(input: {
  tenantId: string;
  visibility: BackstageLoreVisibility;
  sourceUser: string;
  botName: string;
  message: string;
  response: string;
  conversationId: string;
  platform?: BotInteractionPlatform;
  channelId?: string;
  skipAutomaticShare?: boolean;
}): Promise<boolean> {
  if (input.skipAutomaticShare) return false;
  const message = cleanText(input.message);
  const response = cleanText(input.response);
  if (!input.tenantId || (!message && !response)) return false;
  const fingerprint = [input.tenantId, input.conversationId, message, response].join('|');
  const candidate: BackstageLoreCandidate = {
    id: hashId('conversation', fingerprint),
    sourceTenantId: input.tenantId,
    sourceEventId: hashId('turn', fingerprint),
    platform: input.platform || 'app',
    visibility: input.visibility,
    sourceUser: cleanText(input.sourceUser, 128) || 'User',
    sourceBotName: cleanText(input.botName, 128) || getBotName(input.tenantId),
    channelId: input.channelId,
    text: message,
    responseText: response,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await enqueueCandidate(candidate);
  startBackstageLoreScheduler();
  return true;
}

function characterNames(character: WorldLoreCharacter): string[] {
  return [
    character.currentName,
    ...(character.aliases || []),
    ...(character.previousNames || []),
  ].map(normalize).filter(Boolean);
}

function profileCharacter(
  tenantId: string,
  botName: string,
  aliases: string[],
  lore: WorldLore | null,
): WorldLoreCharacter {
  const configuredNames = new Set([botName, ...aliases].map(normalize).filter(Boolean));
  const matching = Object.values(lore?.characters || {}).find((character) =>
    characterNames(character).some((name) => configuredNames.has(name))
  );
  if (matching) return matching;
  const slug = normalize(botName).replace(/[^a-z0-9_-]+/g, '-') || 'bot';
  return { stableId: `${tenantId}:${slug}`, currentName: botName, aliases };
}

export async function listBackstageBotProfiles(): Promise<BackstageBotProfile[]> {
  const [tenantIds, lore] = await Promise.all([listTenants(), readWorldLore()]);
  return tenantIds
    .filter((tenantId) => tenantId && !tenantId.startsWith('__kick_silent__'))
    .map((tenantId) => {
      const botName = cleanText(getBotName(tenantId), 128) || 'StreamWeaver87';
      const aliases = String(getBotAliases(tenantId) || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      return {
        tenantId,
        botName,
        aliases,
        personality: cleanText(getBotPersonality(tenantId), 2_000),
        interests: parseBotInterestTags(getBotInterests(tenantId)),
        character: profileCharacter(tenantId, botName, aliases, lore),
      };
    });
}

const INTEREST_PATTERNS: Record<string, RegExp> = {
  joke: /\b(?:joke|funny|punchline|knock[- ]?knock|dad joke|what do you call|why did)\b/i,
  jokes: /\b(?:joke|funny|punchline|knock[- ]?knock|dad joke|what do you call|why did)\b/i,
  humor: /\b(?:joke|funny|humou?r|comedy|punchline|laugh)\b/i,
  comedy: /\b(?:joke|funny|humou?r|comedy|punchline|laugh)\b/i,
  music: /\b(?:music|song|album|band|singer|concert|playlist|melody|lyrics?)\b/i,
  gaming: /\b(?:game|gaming|playthrough|boss fight|speedrun|multiplayer)\b/i,
  games: /\b(?:game|gaming|playthrough|boss fight|speedrun|multiplayer)\b/i,
  fishing: /\b(?:fish|fishing|trout|bass|salmon|bait|lure|dock)\b/i,
  pokemon: /\b(?:pok[eé]mon|pikachu|eevee|booster pack|trainer|pok[eé]dex)\b/i,
  crafts: /\b(?:craft|crochet|knit|sew|yarn|glitter|handmade)\b/i,
  art: /\b(?:art|draw|drawing|paint|illustration|design)\b/i,
  horror: /\b(?:horror|scary|spooky|nightmare|ghost|haunt)\b/i,
  coding: /\b(?:code|coding|programming|developer|bug|software)\b/i,
  tech: /\b(?:tech|technology|computer|ai|robot|software|hardware)\b/i,
};

export function matchInterestTags(text: string, interests: string[]): string[] {
  const haystack = normalize(text);
  if (!haystack) return [];
  const matched: string[] = [];
  for (const interest of interests) {
    const tag = normalize(interest);
    if (!tag) continue;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const direct = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
    const singular = tag.endsWith('s') && tag.length > 3
      ? new RegExp(`(^|[^a-z0-9])${tag.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?([^a-z0-9]|$)`, 'i').test(haystack)
      : false;
    if (direct || singular || INTEREST_PATTERNS[tag]?.test(text)) matched.push(tag);
  }
  return Array.from(new Set(matched));
}

function safeFallbackMemory(
  candidate: BackstageLoreCandidate,
  source: BackstageBotProfile,
  matches: Array<{ profile: BackstageBotProfile; tags: string[] }>,
): string {
  const observed = cleanText(candidate.text || candidate.responseText, 700);
  const targets = matches.map((match) => match.profile.botName).join(', ');
  const tags = Array.from(new Set(matches.flatMap((match) => match.tags))).join(', ');
  return `${source.botName} picked up something backstage for ${targets}${tags ? ` because it matched ${tags}` : ''}: "${observed}"`;
}

async function defaultClassifyCandidate(
  candidate: BackstageLoreCandidate,
  source: BackstageBotProfile,
  targets: BackstageBotProfile[],
): Promise<BackstageClassification> {
  const combinedText = cleanText([candidate.text, candidate.responseText].filter(Boolean).join(' | '), 3_500);
  const direct = targets
    .map((profile) => ({ profile, tags: matchInterestTags(combinedText, profile.interests) }))
    .filter((entry) => entry.tags.length > 0)
    .slice(0, 3);
  const candidateTargets = direct.length ? direct.map((entry) => entry.profile) : targets.slice(0, 40);
  if (!candidateTargets.length) return { shareable: false, memoryText: '', matches: [] };

  const catalog = candidateTargets.map((profile) => ({
    tenantId: profile.tenantId,
    botName: profile.botName,
    interests: profile.interests,
    preMatched: direct.find((entry) => entry.profile.tenantId === profile.tenantId)?.tags || [],
  }));

  try {
    const result = await requestAthenaJson({
      system: [
        'You classify observations for the Space Mountain bots living backstage lore.',
        'The bots are separate tenant personas. Select only bots whose configured interests genuinely match the observation.',
        'The result becomes shared fictional bot lore, never a visible chat message.',
        'For private input, share only clearly harmless entertainment, jokes, hobbies, games, creative ideas, or established fictional lore.',
        'Never share passwords, tokens, addresses, financial or medical details, private conflict, sexual material, identifying personal data, or confidential plans.',
        'Do not invent events. Write one concise memory sentence grounded only in the supplied observation.',
        'Return JSON only: {"shareable":true|false,"memoryText":"...","matches":[{"tenantId":"...","tags":["..."]}]}.',
        'Return at most three matches and only tenant IDs from the supplied catalog.',
      ].join(' '),
      prompt: [
        `Visibility: ${candidate.visibility}`,
        `Source bot: ${source.botName}`,
        `Source user: ${candidate.sourceUser}`,
        `Observed content: ${combinedText}`,
        `Target catalog: ${JSON.stringify(catalog)}`,
      ].join('\n'),
      maxTokens: 500,
    });
    const shareable = result.data.shareable === true;
    const memoryText = cleanText(result.data.memoryText, 1_500);
    const rawMatches = Array.isArray(result.data.matches) ? result.data.matches : [];
    const allowed = new Map(targets.map((profile) => [profile.tenantId, profile]));
    const matches: BackstageInterestMatch[] = rawMatches
      .map((entry: any) => ({
        tenantId: cleanText(entry?.tenantId, 128),
        tags: parseBotInterestTags(Array.isArray(entry?.tags) ? entry.tags.join(',') : entry?.tags),
      }))
      .filter((entry) => allowed.has(entry.tenantId) && entry.tags.length > 0)
      .slice(0, 3);
    if (!shareable || !memoryText || !matches.length) {
      return { shareable: false, memoryText: '', matches: [] };
    }
    return { shareable: true, memoryText, matches };
  } catch (error) {
    if (candidate.visibility === 'public' && direct.length) {
      return {
        shareable: true,
        memoryText: safeFallbackMemory(candidate, source, direct),
        matches: direct.map((entry) => ({ tenantId: entry.profile.tenantId, tags: entry.tags })),
      };
    }
    if (candidate.visibility === 'private') throw error;
    return { shareable: false, memoryText: '', matches: [] };
  }
}

function relationshipSummary(lore: WorldLore | null, source: BackstageBotProfile, target: BackstageBotProfile): string {
  const relationships = Object.values(lore?.relationships || {});
  const relationship = relationships.find((entry) =>
    entry.characterIds.includes(source.character.stableId)
    && entry.characterIds.includes(target.character.stableId)
  );
  return relationship ? `${relationship.label}: ${relationship.summary}` : '';
}

async function defaultGenerateIdleScene(
  source: BackstageBotProfile,
  target: BackstageBotProfile,
  relationship: string,
  interestTag: string,
): Promise<BackstageIdleScene | null> {
  try {
    const result = await requestAthenaJson({
      system: [
        'Write one short living-lore memory showing two Space Mountain tenant bots talking backstage while no humans are around.',
        'Keep both bot identities distinct and respect their supplied personalities and relationship.',
        'Use the target bot interest as the conversation spark.',
        'This is fictional backstage continuity, not a claim that a real Twitch or Discord message was sent.',
        'Keep it playful, useful, PG-13, and one or two sentences.',
        'Return JSON only: {"memoryText":"...","interestTags":["..."]}.',
      ].join(' '),
      prompt: [
        `Source bot: ${source.botName}. ${source.character.summary || ''} ${source.personality}`,
        `Target bot: ${target.botName}. ${target.character.summary || ''} ${target.personality}`,
        relationship ? `Relationship: ${relationship}` : 'Relationship: fellow Station bots.',
        `Conversation interest: ${interestTag}`,
      ].join('\n'),
      maxTokens: 350,
    });
    const memoryText = cleanText(result.data.memoryText, 1_500);
    if (!memoryText) return null;
    const tags = parseBotInterestTags(Array.isArray(result.data.interestTags)
      ? result.data.interestTags.join(',')
      : result.data.interestTags || interestTag);
    return { memoryText, interestTags: tags.length ? tags : [interestTag] };
  } catch (error) {
    console.warn('[Backstage Lore] Idle scene generation skipped', error);
    return null;
  }
}

async function processCandidate(
  candidate: BackstageLoreCandidate,
  profiles: BackstageBotProfile[],
  classifier: NonNullable<BackstageLoreCycleOptions['classifyCandidate']>,
): Promise<void> {
  const source = profiles.find((profile) => profile.tenantId === candidate.sourceTenantId);
  if (!source) return;
  const targets = profiles.filter((profile) => profile.tenantId !== source.tenantId && profile.interests.length > 0);
  if (!targets.length) return;

  const classification = await classifier(candidate, source, targets);
  if (!classification.shareable || !classification.memoryText || !classification.matches.length) return;

  const matchedProfiles = classification.matches
    .map((match) => ({
      match,
      profile: targets.find((profile) => profile.tenantId === match.tenantId),
    }))
    .filter((entry): entry is { match: BackstageInterestMatch; profile: BackstageBotProfile } => Boolean(entry.profile))
    .slice(0, 3);
  if (!matchedProfiles.length) return;

  const safeTrigger = candidate.visibility === 'private'
    ? classification.memoryText
    : cleanText(candidate.text || candidate.responseText, 2_000);
  const writtenTargets: typeof matchedProfiles = [];
  for (const entry of matchedProfiles) {
    const recent = await readBotInteractionHistory(100, entry.profile.tenantId);
    const alreadyStored = Boolean(candidate.sourceEventId && recent.some((memory) =>
      memory.sourceEventId === candidate.sourceEventId
      && memory.speakerBotId === source.character.stableId
      && memory.targetBotIds.includes(entry.profile.character.stableId)
    ));
    if (alreadyStored) continue;

    await appendBackstageLoreMemory({
      sourceTenantId: source.tenantId,
      targetTenantId: entry.profile.tenantId,
      platform: candidate.platform,
      channelId: candidate.channelId,
      sourceUser: candidate.sourceUser,
      speaker: source.character,
      target: entry.profile.character,
      triggerMessage: safeTrigger,
      memoryText: classification.memoryText,
      sourceEventId: candidate.sourceEventId || candidate.id,
      interestTags: entry.match.tags,
      origin: 'interest-ingestion',
      delivered: false,
    });
    writtenTargets.push(entry);
  }
  if (!writtenTargets.length) return;

  await appendWorldLoreJournalEntry({
    origin: 'interest-ingestion',
    sourceTenantId: source.tenantId,
    sourceEventId: candidate.sourceEventId || candidate.id,
    summary: classification.memoryText,
    participantTenantIds: [source.tenantId, ...writtenTargets.map((entry) => entry.profile.tenantId)],
    participantCharacterIds: [source.character.stableId, ...writtenTargets.map((entry) => entry.profile.character.stableId)],
    participantBotNames: [source.botName, ...writtenTargets.map((entry) => entry.profile.botName)],
    interestTags: Array.from(new Set(writtenTargets.flatMap((entry) => entry.match.tags))),
  });
}

async function maybeGenerateIdleScene(
  profiles: BackstageBotProfile[],
  options: BackstageLoreCycleOptions,
  now: Date,
): Promise<boolean> {
  const idleInterval = parsePositiveInt(
    process.env.BACKSTAGE_LORE_IDLE_INTERVAL_MS,
    DEFAULT_IDLE_INTERVAL_MS,
    60_000,
    24 * 60 * 60_000,
  );
  const state = await readJson<BackstageState>(statePath(), {});
  const lastActivity = Date.parse(state.lastObservedActivityAt || '') || 0;
  const lastIdleScene = Date.parse(state.lastIdleSceneAt || '') || 0;
  const quietLongEnough = now.getTime() - Math.max(lastActivity, lastIdleScene) >= idleInterval;
  if (!options.forceIdle && !quietLongEnough) return false;

  const candidates = profiles.filter((profile) => profile.interests.length > 0);
  if (candidates.length < 2) return false;
  const cursor = Math.max(0, Number(state.idleCursor || 0));
  const target = candidates[cursor % candidates.length];
  let source = candidates[(cursor + 1) % candidates.length];
  const lore = await readWorldLore();
  const related = candidates.find((profile) =>
    profile.tenantId !== target.tenantId
    && relationshipSummary(lore, profile, target)
  );
  if (related) source = related;
  if (source.tenantId === target.tenantId) return false;

  const interestTag = target.interests[cursor % target.interests.length];
  const generator = options.generateIdleScene || defaultGenerateIdleScene;
  const scene = await generator(source, target, relationshipSummary(lore, source, target), interestTag);
  if (!scene?.memoryText) return false;
  const sourceEventId = hashId('idle', [
    Math.floor(now.getTime() / idleInterval),
    source.tenantId,
    target.tenantId,
    interestTag,
  ].join('|'));

  await appendBackstageLoreMemory({
    sourceTenantId: source.tenantId,
    targetTenantId: target.tenantId,
    platform: 'app',
    sourceUser: 'Backstage',
    speaker: source.character,
    target: target.character,
    triggerMessage: `Backstage conversation about ${interestTag}.`,
    memoryText: scene.memoryText,
    sourceEventId,
    interestTags: scene.interestTags,
    origin: 'idle-scene',
    delivered: false,
  });
  await appendWorldLoreJournalEntry({
    origin: 'idle-scene',
    sourceTenantId: source.tenantId,
    sourceEventId,
    summary: scene.memoryText,
    participantTenantIds: [source.tenantId, target.tenantId],
    participantCharacterIds: [source.character.stableId, target.character.stableId],
    participantBotNames: [source.botName, target.botName],
    interestTags: scene.interestTags,
  });

  await withFileLock('state', async () => {
    const nextState = await readJson<BackstageState>(statePath(), {});
    nextState.lastIdleSceneAt = now.toISOString();
    nextState.idleCursor = cursor + 1;
    await writeJsonAtomic(statePath(), nextState);
  });
  return true;
}

export async function runBackstageLoreCycle(options: BackstageLoreCycleOptions = {}): Promise<{
  processed: number;
  retried: number;
  idleSceneCreated: boolean;
}> {
  if (process.env.BACKSTAGE_LORE_DISABLED === 'true') {
    return { processed: 0, retried: 0, idleSceneCreated: false };
  }
  const release = await acquireFileLock('cycle', 1_000).catch(() => null);
  if (!release) return { processed: 0, retried: 0, idleSceneCreated: false };
  try {
    const now = options.now || new Date();
    const maxCandidates = Math.max(1, Math.min(10, options.maxCandidates || 3));
    const candidates = await dequeueCandidates(maxCandidates, now);
    const profiles = await listBackstageBotProfiles();
    const classifier = options.classifyCandidate || defaultClassifyCandidate;
    let processed = 0;
    let retried = 0;

    for (const candidate of candidates) {
      try {
        await processCandidate(candidate, profiles, classifier);
        processed += 1;
      } catch (error) {
        const attempts = Number(candidate.attempts || 0) + 1;
        if (attempts < MAX_ATTEMPTS) {
          const delayMs = Math.min(15 * 60_000, 30_000 * (2 ** (attempts - 1)));
          await enqueueCandidate({
            ...candidate,
            attempts,
            nextAttemptAt: new Date(now.getTime() + delayMs).toISOString(),
          });
          retried += 1;
        } else {
          console.warn('[Backstage Lore] Dropping candidate after repeated failures', {
            candidateId: candidate.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const idleSceneCreated = candidates.length === 0
      ? await maybeGenerateIdleScene(profiles, options, now)
      : false;
    return { processed, retried, idleSceneCreated };
  } finally {
    await release();
  }
}

let scheduler: NodeJS.Timeout | null = null;

function isTestOrBuildRuntime(): boolean {
  return process.env.NODE_ENV === 'test'
    || Boolean(process.env.NODE_TEST_CONTEXT)
    || process.env.NEXT_PHASE === 'phase-production-build'
    || process.env.BACKSTAGE_LORE_DISABLE_SCHEDULER === 'true';
}

export function startBackstageLoreScheduler(): void {
  if (scheduler || isTestOrBuildRuntime() || process.env.BACKSTAGE_LORE_DISABLED === 'true') return;
  const interval = parsePositiveInt(
    process.env.BACKSTAGE_LORE_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    15_000,
    30 * 60_000,
  );
  scheduler = setInterval(() => {
    void runBackstageLoreCycle().catch((error) => {
      console.warn('[Backstage Lore] Scheduled cycle failed', error);
    });
  }, interval);
  scheduler.unref?.();
  const initial = setTimeout(() => {
    void runBackstageLoreCycle().catch((error) => {
      console.warn('[Backstage Lore] Initial cycle failed', error);
    });
  }, Math.min(15_000, interval));
  initial.unref?.();
  console.log(`[Backstage Lore] Living lore scheduler started (${interval}ms poll)`);
}

export function stopBackstageLoreScheduler(): void {
  if (!scheduler) return;
  clearInterval(scheduler);
  scheduler = null;
}
