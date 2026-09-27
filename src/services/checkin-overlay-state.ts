import { promises as fs } from 'fs';
import path from 'path';
import { tenantPath } from '../lib/tenant';

export type CheckinOverlayEvent = {
  type: 'checkin-pending' | 'checkin-reveal';
  payload: Record<string, unknown>;
  eventId: string;
  issuedAt: number;
  expiresAt: number;
};

const FILE_NAME = 'checkin-overlay-current.json';
const validTenantId = (tenantId: string) => /^[a-zA-Z0-9_-]{2,64}$/.test(tenantId);
const pendingWrites = new Map<string, Promise<void>>();
let lastIssuedAt = 0;

export function createCheckinOverlayEvent(
  type: CheckinOverlayEvent['type'],
  payload: Record<string, unknown>,
): CheckinOverlayEvent {
  const issuedAt = lastIssuedAt = Math.max(Date.now(), lastIssuedAt + 1);
  return { type, payload, issuedAt, eventId: String(issuedAt), expiresAt: issuedAt + (type === 'checkin-pending' ? 45_000 : 25_000) };
}

// The Twitch dispatcher and Next.js run in separate processes on the same Fly volume.
// A short lived file lets the HTTPS overlay recover an event when its WebSocket misses it.
export function rememberCheckinOverlayEvent(tenantId: string, event: CheckinOverlayEvent): void {
  if (!validTenantId(tenantId)) return;
  const previous = pendingWrites.get(tenantId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const directory = tenantPath(tenantId, 'data');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, FILE_NAME);
    const temporary = file + '.' + event.eventId + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(event));
    await fs.rename(temporary, file);
  });
  pendingWrites.set(tenantId, next);
  void next.catch(error => console.error('[CheckinOverlay] Unable to save current event:', error))
    .finally(() => { if (pendingWrites.get(tenantId) === next) pendingWrites.delete(tenantId); });
}

export async function readCheckinOverlayEvent(tenantId: string): Promise<CheckinOverlayEvent | null> {
  if (!validTenantId(tenantId)) return null;
  try {
    const data = JSON.parse(await fs.readFile(tenantPath(tenantId, 'data/' + FILE_NAME), 'utf8')) as CheckinOverlayEvent;
    if (!['checkin-pending', 'checkin-reveal'].includes(data.type) || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) return null;
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error('[CheckinOverlay] Unable to load current event:', error);
    return null;
  }
}
