import { promises as fs } from 'fs';
import { resolve } from 'path';
import { readCommanderMemory } from '@/lib/commander-memory';
import { readLTMStore } from '@/lib/ltm-store';
import { getLTMEntries } from '@/lib/private-ltm-store';
import { readPrivateChatMessages } from '@/lib/private-chat-store';
import { readPublicChatMessages } from '@/lib/public-chat-store';
import { tenantPath } from '@/lib/tenant';
import type {
  AthenaActor,
  AthenaLocation,
  AthenaRole,
  AthenaSurface,
  AthenaVisibility,
} from '@/services/athena-contract';

export type AthenaMemoryKind = 'conversation' | 'fact' | 'summary' | 'tool' | 'legacy';

export type AthenaMemoryRecord = {
  id: string;
  tenantId: string;
  visibility: AthenaVisibility;
  kind: AthenaMemoryKind;
  role: AthenaRole;
  content: string;
  sourceApp: string;
  sourceSurface: AthenaSurface | 'legacy';
  conversationId: string;
  channelId?: string;
  channelName?: string;
  messageId?: string;
  participants?: string[];
  confidence?: number;
  createdAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
};

export type AthenaMemoryHit = AthenaMemoryRecord & {
  score: number;
  label: string;
};

export type AthenaMemoryQuery = {
  tenantId: string;
  visibility: AthenaVisibility;
  conversationId: string;
  message: string;
  surface: AthenaSurface;
  limit?: number;
  maxCharacters?: number;
};

const STORE_LIMIT = 2500;
const DEFAULT_HIT_LIMIT = 28;
const DEFAULT_MAX_CHARACTERS = 18_000;
const writeQueues = new Map<string, Promise<void>>();

function memoryFile(tenantId: string): string {
  return tenantPath(tenantId, 'data/athena/memory.json');
}

function normalizeText(value: unknown, max = 12_000): string {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizeTimestamp(value: unknown): string {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function stableId(parts: unknown[]): string {
  const joined = parts.map((part) => String(part || '')).join('|');
  let hash = 2166136261;
  for (let index = 0; index < joined.length; index += 1) {
    hash ^= joined.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ath_${(hash >>> 0).toString(36)}`;
}

function normalizeRecord(value: AthenaMemoryRecord): AthenaMemoryRecord | null {
  const content = normalizeText(value?.content);
  const tenantId = normalizeText(value?.tenantId, 128);
  const conversationId = normalizeText(value?.conversationId, 256);
  if (!content || !tenantId || !conversationId) return null;
  const visibility: AthenaVisibility = value.visibility === 'private' ? 'private' : 'public';
  const kind: AthenaMemoryKind = ['conversation', 'fact', 'summary', 'tool', 'legacy'].includes(value.kind)
    ? value.kind
    : 'conversation';
  const role: AthenaRole = ['user', 'assistant', 'system', 'tool'].includes(value.role)
    ? value.role
    : 'user';
  return {
    ...value,
    id: normalizeText(value.id, 128) || stableId([tenantId, visibility, conversationId, role, content, value.createdAt]),
    tenantId,
    visibility,
    kind,
    role,
    content,
    sourceApp: normalizeText(value.sourceApp, 128) || 'streamweaver',
    sourceSurface: value.sourceSurface || 'legacy',
    conversationId,
    channelId: normalizeText(value.channelId, 128) || undefined,
    channelName: normalizeText(value.channelName, 128) || undefined,
    messageId: normalizeText(value.messageId, 128) || undefined,
    participants: Array.isArray(value.participants)
      ? value.participants.map((item) => normalizeText(item, 128)).filter(Boolean).slice(0, 20)
      : undefined,
    confidence: Number.isFinite(Number(value.confidence))
      ? Math.max(0, Math.min(1, Number(value.confidence)))
      : undefined,
    createdAt: normalizeTimestamp(value.createdAt),
    expiresAt: value.expiresAt ? normalizeTimestamp(value.expiresAt) : undefined,
    metadata: value.metadata && typeof value.metadata === 'object' ? value.metadata : undefined,
  };
}

async function readUnifiedStore(tenantId: string): Promise<AthenaMemoryRecord[]> {
  try {
    const raw = await fs.readFile(memoryFile(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .map((entry) => normalizeRecord(entry))
      .filter((entry): entry is AthenaMemoryRecord => Boolean(entry))
      .filter((entry) => !entry.expiresAt || new Date(entry.expiresAt).getTime() > now);
  } catch {
    return [];
  }
}

async function writeUnifiedStore(tenantId: string, records: AthenaMemoryRecord[]): Promise<void> {
  const file = memoryFile(tenantId);
  await fs.mkdir(resolve(file, '..'), { recursive: true });
  await fs.writeFile(file, JSON.stringify(records.slice(-STORE_LIMIT), null, 2), 'utf-8');
}

export async function appendAthenaMemory(records: AthenaMemoryRecord[]): Promise<void> {
  if (!records.length) return;
  const grouped = new Map<string, AthenaMemoryRecord[]>();
  for (const raw of records) {
    const record = normalizeRecord(raw);
    if (!record) continue;
    const list = grouped.get(record.tenantId) || [];
    list.push(record);
    grouped.set(record.tenantId, list);
  }

  await Promise.all(Array.from(grouped.entries()).map(async ([tenantId, additions]) => {
    const previous = writeQueues.get(tenantId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const existing = await readUnifiedStore(tenantId);
        const byId = new Map(existing.map((entry) => [entry.id, entry]));
        for (const addition of additions) byId.set(addition.id, addition);
        const merged = Array.from(byId.values())
          .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
          .slice(-STORE_LIMIT);
        await writeUnifiedStore(tenantId, merged);
      });
    writeQueues.set(tenantId, next);
    try {
      await next;
    } finally {
      if (writeQueues.get(tenantId) === next) writeQueues.delete(tenantId);
    }
  }));
}

export function buildAthenaTurnRecord(input: {
  tenantId: string;
  visibility: AthenaVisibility;
  conversationId: string;
  role: AthenaRole;
  content: string;
  actor?: AthenaActor;
  location: AthenaLocation;
  kind?: AthenaMemoryKind;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): AthenaMemoryRecord {
  const createdAt = normalizeTimestamp(input.createdAt);
  const participants = [input.actor?.displayName, input.actor?.username]
    .map((value) => normalizeText(value, 128))
    .filter(Boolean);
  return {
    id: stableId([
      input.tenantId,
      input.visibility,
      input.conversationId,
      input.role,
      input.location.messageId,
      input.content,
      createdAt,
    ]),
    tenantId: input.tenantId,
    visibility: input.visibility,
    kind: input.kind || (input.role === 'tool' ? 'tool' : 'conversation'),
    role: input.role,
    content: input.content,
    sourceApp: input.location.app || 'streamweaver',
    sourceSurface: input.location.surface,
    conversationId: input.conversationId,
    channelId: input.location.channelId,
    channelName: input.location.channelName,
    messageId: input.location.messageId,
    participants: participants.length ? Array.from(new Set(participants)) : undefined,
    createdAt,
    metadata: input.metadata,
  };
}

function legacyRecord(input: Omit<AthenaMemoryRecord, 'id' | 'tenantId' | 'kind'> & { tenantId: string }): AthenaMemoryRecord {
  return {
    ...input,
    id: stableId([
      input.tenantId,
      input.visibility,
      input.sourceApp,
      input.sourceSurface,
      input.conversationId,
      input.role,
      input.content,
      input.createdAt,
    ]),
    kind: 'legacy',
  };
}

async function readLegacyMemory(tenantId: string, visibility: AthenaVisibility): Promise<AthenaMemoryRecord[]> {
  const records: AthenaMemoryRecord[] = [];
  const publicMessages = await readPublicChatMessages(120, tenantId);
  for (const message of publicMessages) {
    records.push(legacyRecord({
      tenantId,
      visibility: 'public',
      role: message.type === 'ai' ? 'assistant' : 'user',
      content: message.message,
      sourceApp: 'streamweaver',
      sourceSurface: 'legacy',
      conversationId: `${tenantId}:legacy-public`,
      participants: [message.username],
      createdAt: normalizeTimestamp(message.timestamp),
    }));
  }

  const publicLtm = await readLTMStore(tenantId);
  for (const memory of publicLtm.memories.slice(-80)) {
    records.push(legacyRecord({
      tenantId,
      visibility: 'public',
      role: 'system',
      content: `${memory.title}: ${memory.content}`,
      sourceApp: 'streamweaver',
      sourceSurface: 'legacy',
      conversationId: `${tenantId}:legacy-public-ltm`,
      createdAt: normalizeTimestamp(memory.lastAccessedAt || memory.createdAt),
      confidence: 0.9,
    }));
  }

  if (visibility === 'private') {
    const [privateMessages, privateLtm, commander] = await Promise.all([
      readPrivateChatMessages(160, tenantId),
      getLTMEntries(tenantId),
      readCommanderMemory(80),
    ]);
    for (const message of privateMessages) {
      records.push(legacyRecord({
        tenantId,
        visibility: 'private',
        role: message.type === 'ai' ? 'assistant' : 'user',
        content: message.message,
        sourceApp: 'streamweaver',
        sourceSurface: 'legacy',
        conversationId: `${tenantId}:legacy-private`,
        participants: [message.username],
        createdAt: normalizeTimestamp(message.timestamp),
      }));
    }
    for (const memory of privateLtm.slice(-100)) {
      records.push(legacyRecord({
        tenantId,
        visibility: 'private',
        role: 'system',
        content: `${memory.title}: ${memory.content}`,
        sourceApp: 'streamweaver',
        sourceSurface: 'legacy',
        conversationId: `${tenantId}:legacy-private-ltm`,
        createdAt: normalizeTimestamp(memory.createdAt),
        confidence: 0.95,
      }));
    }
    for (const memory of commander) {
      records.push(legacyRecord({
        tenantId,
        visibility: 'private',
        role: 'system',
        content: `Commander said: ${memory.message}\nAthena replied: ${memory.response}`,
        sourceApp: 'streamweaver',
        sourceSurface: 'legacy',
        conversationId: `${tenantId}:legacy-commander`,
        participants: ['mtman1987'],
        createdAt: normalizeTimestamp(memory.timestamp),
        confidence: 0.9,
        metadata: { originalTenantId: memory.tenantId, originalBotName: memory.botName },
      }));
    }
  }

  return records;
}

function tokens(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9_'-]+/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .slice(0, 80),
  ));
}

function scoreRecord(record: AthenaMemoryRecord, query: AthenaMemoryQuery, queryTokens: string[]): number {
  const now = Date.now();
  const created = new Date(record.createdAt).getTime();
  const ageDays = Number.isFinite(created) ? Math.max(0, (now - created) / 86_400_000) : 365;
  let score = Math.max(0, 8 - Math.log2(ageDays + 1));
  if (record.conversationId === query.conversationId) score += 45;
  if (record.sourceSurface === query.surface) score += 6;
  if (record.kind === 'fact' || record.kind === 'summary') score += 4;
  if (record.role === 'system' || record.role === 'tool') score += 2;
  if (record.visibility === 'private' && query.visibility === 'private') score += 1;

  const haystack = `${record.content} ${record.participants?.join(' ') || ''}`.toLowerCase();
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += token.length >= 7 ? 5 : 3;
  }
  return score;
}

function memoryLabel(record: AthenaMemoryRecord): string {
  const privacy = record.visibility === 'private' ? 'Private' : 'Public';
  const place = record.sourceSurface === 'legacy'
    ? record.sourceApp
    : `${record.sourceApp}/${record.sourceSurface}`;
  return `${privacy} · ${place}`;
}

export async function retrieveAthenaMemory(query: AthenaMemoryQuery): Promise<AthenaMemoryHit[]> {
  const [unified, legacy] = await Promise.all([
    readUnifiedStore(query.tenantId),
    readLegacyMemory(query.tenantId, query.visibility),
  ]);
  const allowed = [...unified, ...legacy].filter((entry) =>
    entry.visibility === 'public' || query.visibility === 'private'
  );
  const queryTokens = tokens(query.message);
  const scored = allowed.map((entry) => ({
    ...entry,
    score: scoreRecord(entry, query, queryTokens),
    label: memoryLabel(entry),
  }));

  const latestConversation = scored
    .filter((entry) => entry.conversationId === query.conversationId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 18);
  const relevant = scored
    .filter((entry) => entry.conversationId !== query.conversationId)
    .sort((left, right) => right.score - left.score || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  const deduped: AthenaMemoryHit[] = [];
  const seen = new Set<string>();
  const maxCharacters = query.maxCharacters || DEFAULT_MAX_CHARACTERS;
  const limit = query.limit || DEFAULT_HIT_LIMIT;
  let characters = 0;
  for (const entry of [...latestConversation.reverse(), ...relevant]) {
    const key = entry.content.toLowerCase().replace(/\s+/g, ' ').slice(0, 500);
    if (!key || seen.has(key)) continue;
    if (characters + entry.content.length > maxCharacters) continue;
    seen.add(key);
    deduped.push(entry);
    characters += entry.content.length;
    if (deduped.length >= limit) break;
  }
  return deduped;
}

export function formatAthenaMemoryForPrompt(hits: AthenaMemoryHit[]): string {
  if (!hits.length) return 'No relevant stored memory was retrieved.';
  return hits.map((hit) => {
    const source = [
      hit.label,
      hit.channelName ? `channel=${hit.channelName}` : '',
      hit.createdAt,
    ].filter(Boolean).join(' · ');
    const speaker = hit.role === 'assistant' ? 'Athena' : hit.role === 'tool' ? 'Tool' : hit.participants?.[0] || hit.role;
    return `[${source}] ${speaker}: ${hit.content}`;
  }).join('\n');
}

export function memorySourcesForResponse(hits: AthenaMemoryHit[]) {
  return hits.map((hit) => ({
    id: hit.id,
    visibility: hit.visibility,
    label: hit.label,
    sourceApp: hit.sourceApp,
    sourceSurface: hit.sourceSurface,
    timestamp: hit.createdAt,
  }));
}
