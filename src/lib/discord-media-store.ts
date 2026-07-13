import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

export const DISCORD_MEDIA_SLOTS = ['private-dm', 'public-discord'] as const;
export type DiscordMediaSlotName = typeof DISCORD_MEDIA_SLOTS[number];

export function isDiscordMediaSlot(value: unknown): value is DiscordMediaSlotName {
  return DISCORD_MEDIA_SLOTS.includes(value as DiscordMediaSlotName);
}

export function discordMediaFilename(slot: DiscordMediaSlotName) {
  return `${slot}.gif`;
}

export function getDiscordMediaPublicPath(slot: DiscordMediaSlotName) {
  return `/api/discord-media/${discordMediaFilename(slot)}`;
}

function runtimeDiscordMediaDir() {
  return process.env.DISCORD_MEDIA_DIR ||
    (process.env.FLY_APP_NAME
      ? '/data/runtime/discord-media'
      : resolve(process.cwd(), 'data', 'runtime', 'discord-media'));
}

function publicAvatarPath(filename: string) {
  return resolve(process.cwd(), 'public', 'avatars', filename);
}

export async function writeDiscordMedia(slot: DiscordMediaSlotName, buffer: Buffer) {
  const filename = discordMediaFilename(slot);
  const runtimeDir = runtimeDiscordMediaDir();
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(join(runtimeDir, filename), buffer);

  if (!process.env.FLY_APP_NAME) {
    const publicDir = resolve(process.cwd(), 'public', 'avatars');
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(publicDir, filename), buffer);
  }

  return { filename };
}

export async function readDiscordMedia(slot: DiscordMediaSlotName) {
  const filename = discordMediaFilename(slot);
  const candidates = [
    join(runtimeDiscordMediaDir(), filename),
    publicAvatarPath(filename),
    publicAvatarPath(slot === 'private-dm' ? 'idle.gif' : 'talking.gif'),
    publicAvatarPath('idle.gif'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const body = await readFile(candidate);
    return { body, sourcePath: candidate };
  }

  return null;
}
