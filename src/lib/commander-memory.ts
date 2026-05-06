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

export function formatCommanderHistory(messages: CommanderMessage[]): string {
  if (messages.length === 0) return '';
  const lines = messages.slice(-10).map(m =>
    `[${m.botName} in ${m.tenantId}] M.T.: ${m.message}\n${m.botName}: ${m.response}`
  );
  return `Your history with the Commander across streams:\n${lines.join('\n\n')}`;
}
