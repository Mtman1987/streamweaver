import type { PrivateChatMessage } from '@/lib/private-chat-store';

export type PrivateDmLiveTtsTurn = {
  cursor: number;
  text: string;
  question: string;
  timestamp: string;
};

function timestampMs(value: unknown): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function latestPrivateAiCursor(messages: PrivateChatMessage[]): number {
  let latest = 0;
  for (const entry of messages) {
    if (entry.type !== 'ai') continue;
    latest = Math.max(latest, timestampMs(entry.timestamp));
  }
  return latest;
}

export function findPrivateAiCursorByText(
  messages: PrivateChatMessage[],
  text: string,
): number {
  const target = normalizeText(text);
  if (!target) return 0;

  for (let index = messages.length - 1; index >= 0; index--) {
    const entry = messages[index];
    if (entry.type !== 'ai') continue;
    if (normalizeText(entry.message) !== target) continue;
    return timestampMs(entry.timestamp);
  }
  return 0;
}

export function listPrivateAiTurnsAfter(
  messages: PrivateChatMessage[],
  afterMs: number,
  limit = 4,
): PrivateDmLiveTtsTurn[] {
  const normalizedAfter = Math.max(0, Number(afterMs) || 0);
  const turns: PrivateDmLiveTtsTurn[] = [];
  let lastQuestion = '';

  for (const entry of messages) {
    if (entry.type === 'user') {
      lastQuestion = String(entry.message || '').trim();
      continue;
    }
    if (entry.type !== 'ai') continue;

    const cursor = timestampMs(entry.timestamp);
    const text = String(entry.message || '').trim();
    if (!cursor || cursor <= normalizedAfter || !text) continue;

    turns.push({
      cursor,
      text,
      question: lastQuestion,
      timestamp: entry.timestamp,
    });
  }

  return turns
    .sort((left, right) => left.cursor - right.cursor)
    .slice(0, Math.max(1, Math.min(8, Math.floor(limit) || 4)));
}
