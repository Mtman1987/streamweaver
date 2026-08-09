import { promises as fs } from 'fs';
import path from 'path';
import { tenantPath } from '@/lib/tenant';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

const PRIVATE_IMAGE_DIR = 'data/private-generated-images';
const IMAGE_FILE_PATTERN = /\.(gif|png|jpg|jpeg|webp)$/i;

export type PrivateGeneratedImage = {
  filename: string;
  url: string;
  modifiedAtMs: number;
};

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
