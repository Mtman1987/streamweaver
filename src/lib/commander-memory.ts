/**
 * Global Commander Memory — cross-stream conversation history for mtman1987.
 * Stored at /data/runtime/global/commander-memory.json
 */

import * as fs from 'fs/promises';
import { globalPath } from './tenant';

const COMMANDER_USERNAME = 'mtman1987';
const MEMORY_FILE = 'commander-memory.json';
const MAX_MESSAGES = 50;

const COMMANDER_SYSTEM_PROMPT = `IMPORTANT OVERRIDE FOR THIS USER: This is the Commander (M.T.), the creator of StreamWeaver and your oldest friend. No matter what personality you have, you know M.T. personally. Address them as "Commander" or "M.T." — never by their Twitch username. Chat with them like old friends catching up. You've been through countless streams together. Be warm, familiar, and genuine with them.`;

export type CommanderMessage = {
  botName: string;
  tenantId: string;
  message: string;
  response: string;
  timestamp: string;
};

const QUERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'before', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'i', 'in', 'is', 'it', 'just',
  'me', 'my', 'of', 'on', 'or', 'please', 'that', 'the', 'then', 'there', 'this', 'to', 'was',
  'were', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'would', 'you', 'your',
  'remember', 'recall', 'remind', 'memory', 'earlier', 'previous', 'previously', 'ago',
]);

function getMemoryPath(): string {
  return globalPath(MEMORY_FILE);
}

export function isCommander(username: string): boolean {
  return username.toLowerCase() === COMMANDER_USERNAME;
}

export function getCommanderSystemPrompt(): string {
  return COMMANDER_SYSTEM_PROMPT;
}

export async function readCommanderMemory(limit = 20): Promise<CommanderMessage[]> {
  try {
    const raw = await fs.readFile(getMemoryPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-limit);
  } catch {
    return [];
  }
}

export async function appendCommanderMemory(entry: CommanderMessage): Promise<void> {
  const filePath = getMemoryPath();
  const dir = filePath.replace(/[/\\][^/\\]+$/, '');
  await fs.mkdir(dir, { recursive: true });

  const existing = await readCommanderMemory(MAX_MESSAGES);
  const merged = [...existing, entry].slice(-MAX_MESSAGES);
  await fs.writeFile(filePath, JSON.stringify(merged, null, 2));
}

function queryTerms(value: string): string[] {
  return Array.from(new Set(
    String(value || '')
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((word) => word.length > 1 && !QUERY_STOPWORDS.has(word)) || [],
  ));
}

function memorySearchText(memory: CommanderMessage): string {
  return `${memory.message || ''} ${memory.response || ''}`.toLowerCase();
}

/**
 * Pick a compact Commander-memory packet for the current turn. This lets recall
 * questions search the full 50-entry store without dumping all 50 entries into
 * the LLM prompt. Recent continuity is always represented, then relevant older
 * memories are ranked by query overlap and recency.
 */
export function selectCommanderMemoryForPrompt(
  messages: CommanderMessage[],
  query: string,
  limit = 8,
): CommanderMessage[] {
  const source = Array.isArray(messages) ? messages : [];
  const safeLimit = Math.max(1, Math.min(12, Math.floor(limit || 8)));
  if (source.length <= safeLimit) return source;

  const terms = queryTerms(query);
  const selectedIndexes = new Set<number>();

  // Preserve the latest couple of exchanges so a recall answer still feels
  // like part of the active conversation rather than a database lookup.
  for (let index = Math.max(0, source.length - 2); index < source.length; index++) {
    selectedIndexes.add(index);
  }

  const ranked = source
    .map((memory, index) => {
      const haystack = memorySearchText(memory);
      let overlap = 0;
      for (const term of terms) {
        if (haystack.includes(term)) overlap += 1;
      }
      // Numeric tokens are especially useful for questions such as "what number
      // did I ask you to remember?" and should outrank generic word matches.
      const queryNumbers = terms.filter((term) => /^\d+$/.test(term));
      const numericOverlap = queryNumbers.filter((term) => haystack.includes(term)).length;
      return { index, overlap, numericOverlap };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((left, right) =>
      right.numericOverlap - left.numericOverlap ||
      right.overlap - left.overlap ||
      right.index - left.index
    );

  for (const entry of ranked) {
    if (selectedIndexes.size >= safeLimit) break;
    selectedIndexes.add(entry.index);
  }

  // If the query has weak/no lexical overlap, fill the remaining budget with
  // recent entries rather than bloating the prompt with the whole archive.
  for (let index = source.length - 1; index >= 0 && selectedIndexes.size < safeLimit; index--) {
    selectedIndexes.add(index);
  }

  return [...selectedIndexes]
    .sort((a, b) => a - b)
    .map((index) => source[index]);
}

export function formatCommanderHistory(messages: CommanderMessage[]): string {
  if (messages.length === 0) return '';
  const lines = messages.slice(-12).map(m =>
    `[${m.botName} in ${m.tenantId}] M.T.: ${m.message}\n${m.botName}: ${m.response}`
  );
  return `Relevant history with the Commander across streams:\n${lines.join('\n\n')}`;
}
