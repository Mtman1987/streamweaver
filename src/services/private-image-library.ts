import { promises as fs } from 'fs';
import path from 'path';
import { tenantPath } from '@/lib/tenant';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

const PRIVATE_IMAGE_DIR = 'data/private-generated-images';
const IMAGE_FILE_PATTERN = /\.(gif|png|jpg|jpeg|webp)$/i;
const SAFE_IMAGE_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.(gif|png|jpg|jpeg|webp)$/i;
const SAFE_GIF_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.gif$/i;

export type PrivateGeneratedImage = {
  filename: string;
  url: string;
  modifiedAtMs: number;
};

export type DeletePrivateGeneratedImageResult = 'deleted' | 'not_found' | 'invalid';

export function isSafePrivateGeneratedGifFilename(filename: string): boolean {
  const normalized = String(filename || '').trim();
  return SAFE_GIF_FILENAME_PATTERN.test(normalized) && path.basename(normalized) === normalized;
}

export async function readPrivateGeneratedGif(
  tenantId: string,
  filename: string,
): Promise<Buffer | null> {
  const normalizedTenantId = String(tenantId || '').trim();
  const normalizedFilename = String(filename || '').trim();
  if (!normalizedTenantId || !isSafePrivateGeneratedGifFilename(normalizedFilename)) return null;

  try {
    return await fs.readFile(path.join(tenantPath(normalizedTenantId, PRIVATE_IMAGE_DIR), normalizedFilename));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function listPrivateGeneratedImages(tenantId: string): Promise<PrivateGeneratedImage[]> {
  const normalizedTenantId = String(tenantId || '').trim();
  if (!normalizedTenantId) return [];

  const dir = tenantPath(normalizedTenantId, PRIVATE_IMAGE_DIR);
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((name) => IMAGE_FILE_PATTERN.test(name));
  } catch {
    return [];
  }

  const entries = await Promise.all(names.map(async (filename) => {
    try {
      const stat = await fs.stat(path.join(dir, filename));
      const params = new URLSearchParams({
        tenantId: normalizedTenantId,
        scope: 'private',
      });
      const base = getConfiguredAppUrl();
      const relativeUrl = `/api/ai/image/file/${encodeURIComponent(filename)}?${params.toString()}`;
      return {
        filename,
        url: base ? `${base}${relativeUrl}` : relativeUrl,
        modifiedAtMs: stat.mtimeMs,
      } satisfies PrivateGeneratedImage;
    } catch {
      return null;
    }
  }));

  return entries
    .filter((entry): entry is PrivateGeneratedImage => Boolean(entry))
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs || right.filename.localeCompare(left.filename));
}

export async function listPrivateGeneratedImageUrls(tenantId: string): Promise<string[]> {
  return (await listPrivateGeneratedImages(tenantId)).map((entry) => entry.url);
}

export async function deletePrivateGeneratedImage(
  tenantId: string,
  filename: string,
): Promise<DeletePrivateGeneratedImageResult> {
  const normalizedTenantId = String(tenantId || '').trim();
  const normalizedFilename = String(filename || '').trim();
  if (!normalizedTenantId || !SAFE_IMAGE_FILENAME_PATTERN.test(normalizedFilename)) return 'invalid';
  if (path.basename(normalizedFilename) !== normalizedFilename) return 'invalid';

  const filePath = path.join(tenantPath(normalizedTenantId, PRIVATE_IMAGE_DIR), normalizedFilename);
  try {
    await fs.unlink(filePath);
    return 'deleted';
  } catch (error: any) {
    if (error?.code === 'ENOENT') return 'not_found';
    throw error;
  }
}
