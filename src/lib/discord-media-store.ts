import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { tenantPath } from '@/lib/tenant';

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
  await writeFile(join(runtimeDir, filename), buffer);

  return { filename };
}

export async function readDiscordMedia(slot: DiscordMediaSlotName, tenantId?: string) {
  const filename = discordMediaFilename(slot);
  const candidates = [
    ...(tenantId ? [join(tenantPath(tenantId, 'data/discord-media'), filename)] : []),
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
