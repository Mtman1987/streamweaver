import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tenantPath } from '@/lib/tenant';

const DISCORD_THUMBNAIL_WIDTH = 128;
const DISCORD_THUMBNAIL_MAX_BYTES = 7 * 1024 * 1024;
const optimizationPromises = new Map<string, Promise<Buffer>>();

function sourceCandidates(tenantId?: string): string[] {
  return [
    ...(tenantId ? [tenantPath(tenantId, 'data/avatars/idle.gif')] : []),
    path.resolve(process.cwd(), 'data', 'avatars', 'idle.gif'),
    path.resolve(process.cwd(), 'public', 'avatars', 'idle.gif'),
  ];
}

export function hasTenantOwnAvatar(tenantId?: string): boolean {
  if (!tenantId) return false;
  return existsSync(tenantPath(tenantId, 'data/avatars/idle.gif'));
}

function findSource(tenantId?: string): string | null {
  return sourceCandidates(tenantId).find((candidate) => existsSync(candidate)) || null;
}

function optimizedPath(tenantId?: string): string {
  return tenantId
    ? tenantPath(tenantId, 'data/avatars/idle-discord-thumbnail.gif')
    : path.resolve(process.cwd(), 'data', 'runtime', 'global', 'idle-discord-thumbnail.gif');
}

export function getDiscordAvatarVersion(tenantId?: string): string {
  const source = findSource(tenantId);
  if (!source) return 'missing';
  try {
    const sourceStat = statSync(source);
    return `${Math.trunc(sourceStat.mtimeMs).toString(36)}-${sourceStat.size.toString(36)}`;
  } catch {
    return 'unknown';
  }
}

export async function optimizeDiscordAvatarGif(source: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const firstPass = await sharp(source, { animated: true, limitInputPixels: false })
    .resize({ width: DISCORD_THUMBNAIL_WIDTH, withoutEnlargement: true })
    .gif({ effort: 7, colours: 128 })
    .toBuffer();

  if (firstPass.length <= DISCORD_THUMBNAIL_MAX_BYTES) return firstPass;

  return sharp(source, { animated: true, limitInputPixels: false })
    .resize({ width: 96, withoutEnlargement: true })
    .gif({ effort: 8, colours: 64 })
    .toBuffer();
}

async function buildOptimizedAvatar(source: string, target: string): Promise<Buffer> {
  const [sourceStat, targetStat] = await Promise.all([
    stat(source),
    stat(target).catch(() => null),
  ]);
  if (targetStat && targetStat.mtimeMs >= sourceStat.mtimeMs && targetStat.size <= DISCORD_THUMBNAIL_MAX_BYTES) {
    return readFile(target);
  }

  const original = await readFile(source);
  try {
    const optimized = await optimizeDiscordAvatarGif(original);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, optimized);
    try {
      await rename(temporary, target);
    } catch {
      await rm(target, { force: true });
      await rename(temporary, target);
    }
    return optimized;
  } catch (error) {
    console.error('[Discord Avatar] GIF optimization failed; serving original animation', {
      error: error instanceof Error ? error.message : String(error),
    });
    return original;
  }
}

export async function readDiscordAvatarThumbnail(tenantId?: string): Promise<Buffer | null> {
  const source = findSource(tenantId);
  if (!source) return null;
  const target = optimizedPath(tenantId);
  const key = `${source}:${target}`;
  const existing = optimizationPromises.get(key);
  if (existing) return existing;

  const pending = buildOptimizedAvatar(source, target).finally(() => optimizationPromises.delete(key));
  optimizationPromises.set(key, pending);
  return pending;
}

export const DISCORD_AVATAR_THUMBNAIL_MAX_BYTES = DISCORD_THUMBNAIL_MAX_BYTES;
