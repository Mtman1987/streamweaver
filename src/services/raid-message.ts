import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tenantPath } from '@/lib/tenant';

export function parseRaidMessageCommand(message: string): { text: string } | null {
  const match = String(message || '').trim().match(/^!(?:raidmessage|raid)(?:\s+([\s\S]*))?$/i);
  return match ? { text: String(match[1] || '').replace(/\s+/g, ' ').trim() } : null;
}

async function readSavedMessage(tenantId: string): Promise<string> {
  // Preserve messages saved by the previous !raidmessage handler.
  for (const relative of ['data/raid-message.json', 'tokens/raid-message.json']) {
    try {
      const saved = JSON.parse(await fs.readFile(tenantPath(tenantId, relative), 'utf8'));
      const text = String(saved.message || '').trim();
      if (text) return text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return '';
}

export async function handleRaidMessageCommand(input: {
  message: string; tenantId?: string;
}): Promise<string | null> {
  const parsed = parseRaidMessageCommand(input.message);
  if (!parsed) return null;
  if (!input.tenantId || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.tenantId)) {
    return 'Raid messages need a connected streamer account.';
  }
  if (!parsed.text) {
    return await readSavedMessage(input.tenantId)
      || 'No raid message saved yet. Type !raid Your message here. Then !raid posts it.';
  }
  if (parsed.text.length > 450) return 'That raid message is too long. Use 450 characters or fewer; your saved message has not changed.';
  const file = tenantPath(input.tenantId, 'data/raid-message.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp.' + randomUUID();
  try {
    await fs.writeFile(temp, JSON.stringify({ message: parsed.text, updatedAt: new Date().toISOString() }) + '\n', 'utf8');
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(() => {}); }
  // Read from disk before reporting success.
  if (await readSavedMessage(input.tenantId) !== parsed.text) throw new Error('Raid message save verification failed');
  return '✅ Raid message saved. Type !raid or !raidmessage to post it. Add text to either command to change it.';
}
