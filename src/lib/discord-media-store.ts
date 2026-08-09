import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { tenantPath } from '@/lib/tenant';
import { DISCORD_MEDIA_MAX_FILE_BYTES } from '@/lib/discord-media-limits';

export const DISCORD_MEDIA_SLOTS = ['private-dm', 'public-discord'] as const;
export type DiscordMediaSlotName = typeof DISCORD_MEDIA_SLOTS[number];

export function isDiscordMediaSlot(value: unknown): value is DiscordMediaSlotName {
  return DISCORD_MEDIA_SLOTS.includes(value as DiscordMediaSlotName);
}

export function discordMediaFilename(slot: DiscordMediaSlotName) {
  return `${slot}.gif`;
}

export function getDiscordMediaPublicPath(slot: DiscordMediaSlotName, tenantId?: string) {
  const path = `/api/discord-media/${discordMediaFilename(slot)}`;
  return tenantId ? `${path}?tenant=${encodeURIComponent(tenantId)}` : path;
}

function tenantDiscordMediaPath(slot: DiscordMediaSlotName, tenantId: string) {
  return join(tenantPath(tenantId, 'data/discord-media'), discordMediaFilename(slot));
}

function legacyRuntimeDiscordMediaDir() {
  return process.env.DISCORD_MEDIA_DIR ||
    (process.env.FLY_APP_NAME
      ? '/data/runtime/discord-media'
      : resolve(process.cwd(), 'data', 'runtime', 'discord-media'));
}

function publicAvatarPath(filename: string) {
  return resolve(process.cwd(), 'public', 'avatars', filename);
}

export async function writeDiscordMedia(slot: DiscordMediaSlotName, buffer: Buffer, tenantId: string) {
  if (!tenantId) throw new Error('Discord media requires a tenant ID');
  const filename = discordMediaFilename(slot);
  const runtimeDir = tenantPath(tenantId, 'data/discord-media');
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(tenantDiscordMediaPath(slot, tenantId), buffer);

  return { filename };
}

export async function readTenantDiscordMedia(slot: DiscordMediaSlotName, tenantId: string) {
  if (!tenantId) return null;
  const sourcePath = tenantDiscordMediaPath(slot, tenantId);
  if (!existsSync(sourcePath)) return null;
  return { body: await readFile(sourcePath), sourcePath };
}

export async function deleteTenantDiscordMedia(slot: DiscordMediaSlotName, tenantId: string) {
  if (!tenantId) throw new Error('Discord media requires a tenant ID');
  const sourcePath = tenantDiscordMediaPath(slot, tenantId);
  try {
    await unlink(sourcePath);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function discordStreamHubOrigin(): string {
  const configured = (
    process.env.DISCORD_STREAM_HUB_URL ||
    process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL ||
    'https://discord-stream-hub-new.fly.dev'
  ).trim();
  try {
    return new URL(configured).origin;
  } catch {
    return '';
  }
}

export function isDiscordStreamHubStoredMediaUrl(value: string): boolean {
  try {
    const url = new URL(String(value || '').trim());
    return Boolean(discordStreamHubOrigin()) &&
      url.origin === discordStreamHubOrigin() &&
      url.pathname.startsWith('/api/media/streamweaver/');
  } catch {
    return false;
  }
}

export async function importDiscordStreamHubMedia(
  slot: DiscordMediaSlotName,
  sourceUrl: string,
  tenantId: string,
): Promise<boolean> {
  if (!isDiscordStreamHubStoredMediaUrl(sourceUrl)) return false;
  const response = await fetch(sourceUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`DiscordStreamHub media import failed: ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > DISCORD_MEDIA_MAX_FILE_BYTES) {
    throw new Error('Converted GIF is larger than the StreamWeaver media limit');
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length || body.length > DISCORD_MEDIA_MAX_FILE_BYTES) {
    throw new Error('Converted GIF is empty or larger than the StreamWeaver media limit');
  }
  await writeDiscordMedia(slot, body, tenantId);
  return true;
}

export async function readDiscordMedia(slot: DiscordMediaSlotName, tenantId?: string) {
  const filename = discordMediaFilename(slot);
  const candidates = [
    ...(tenantId ? [tenantDiscordMediaPath(slot, tenantId)] : []),
    // Grandfather the former global upload location until the owner uploads a
    // tenant-specific replacement. Never substitute idle/talking avatar media.
    join(legacyRuntimeDiscordMediaDir(), filename),
    publicAvatarPath(filename),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const body = await readFile(candidate);
    return { body, sourcePath: candidate };
  }

  return null;
}
