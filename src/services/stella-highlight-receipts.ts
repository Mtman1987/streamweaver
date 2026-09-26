import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tenantPath } from '../lib/tenant';

const RECEIPT_TTL_MS = 2 * 60_000;
const MAX_RECEIPTS = 60;
type Receipt = { messageId: string; queuedAt: number };

function receiptPath(tenantId: string): string {
  return tenantPath(tenantId, 'data/stella-highlight-receipts.json');
}

async function readReceipts(tenantId: string): Promise<Receipt[]> {
  try {
    const parsed = JSON.parse(await readFile(receiptPath(tenantId), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Highlight Stella only after her confirmed Twitch line has reached the TTS queue. */
export async function recordStellaHighlightTtsReceipt(messageId: string, tenantId: string): Promise<void> {
  if (!messageId || !tenantId) return;
  const now = Date.now();
  const entries = (await readReceipts(tenantId))
    .filter((entry) => entry.messageId !== messageId && now - entry.queuedAt < RECEIPT_TTL_MS);
  entries.push({ messageId, queuedAt: now });
  const file = receiptPath(tenantId);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(entries.slice(-MAX_RECEIPTS)), 'utf8');
  await rename(temporary, file);
}

export async function hasStellaHighlightTtsReceipt(messageId: string, tenantId: string): Promise<boolean> {
  if (!messageId || !tenantId) return false;
  const now = Date.now();
  return (await readReceipts(tenantId)).some(
    (entry) => entry.messageId === messageId
      && Number.isFinite(entry.queuedAt)
      && now >= entry.queuedAt
      && now - entry.queuedAt < RECEIPT_TTL_MS,
  );
}
