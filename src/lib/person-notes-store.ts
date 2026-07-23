/**
 * Consent-based person memory notes, stored per tenant at
 * /data/runtime/<tenant>/person-notes.json
 */

import * as fs from 'fs/promises';
import { tenantPath, globalPath } from './tenant';

const NOTES_FILE = 'person-notes.json';
const MAX_NOTES = 500;

export type PersonNote = {
  id: string;
  personId: string;
  note: string;
  consent: boolean;
  createdAt: string;
};

function getNotesPath(tenantId: string): string {
  return tenantId ? tenantPath(tenantId, NOTES_FILE) : globalPath(NOTES_FILE);
}

export async function readPersonNotes(tenantId: string, limit = 50): Promise<PersonNote[]> {
  try {
    const raw = await fs.readFile(getNotesPath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-limit);
  } catch {
    return [];
  }
}

export async function appendPersonNote(
  tenantId: string,
  entry: Omit<PersonNote, 'id' | 'createdAt'>,
): Promise<PersonNote> {
  const filePath = getNotesPath(tenantId);
  const dir = filePath.replace(/[/\\][^/\\]+$/, '');
  await fs.mkdir(dir, { recursive: true });

  const record: PersonNote = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  };

  const existing = await readPersonNotes(tenantId, MAX_NOTES);
  const merged = [...existing, record].slice(-MAX_NOTES);
  await fs.writeFile(filePath, JSON.stringify(merged, null, 2));
  return record;
}
