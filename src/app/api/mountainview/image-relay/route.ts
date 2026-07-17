import { NextRequest } from 'next/server';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { tenantPath, globalPath } from '@/lib/tenant';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { runImageCommand } from '@/services/image-command';
import { hasMountainViewBridgeAccess } from '@/lib/internal-service-auth';

const relaySchema = z.object({
  source: z.string().trim().max(128).optional(),
  imageBase64: z.string().optional(),
  imageUrl: z.string().trim().max(4000).optional(),
  prompt: z.string().trim().max(3000).optional(),
  tenantId: z.string().trim().max(128).optional(),
  username: z.string().trim().max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
});

type RelayRecord = {
  id: string;
  createdAt: string;
  source: string;
  tenantId: string;
  username: string;
  imageUrl: string;
  storedImageUrl: string | null;
  prompt: string;
  metadata: Record<string, unknown>;
  imageCommand?: unknown;
};

function getRelayIndexPath(tenantId?: string): string {
  return tenantId ? tenantPath(tenantId, 'data/mountainview-image-relay/index.json') : globalPath('data/mountainview-image-relay/index.json');
}

function getRelayFilePath(tenantId: string | undefined, filename: string): string {
  return tenantId ? tenantPath(tenantId, `data/generated-images/${filename}`) : globalPath(`data/generated-images/${filename}`);
}

async function appendRelayRecord(record: RelayRecord): Promise<void> {
  const file = getRelayIndexPath(record.tenantId === 'global' ? undefined : record.tenantId);
  let records: RelayRecord[] = [];
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    records = Array.isArray(parsed) ? parsed : [];
  } catch {}
  records.push(record);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(records.slice(-300), null, 2), 'utf8');
}

async function persistBase64Image(imageBase64: string, tenantId: string | undefined, request: NextRequest): Promise<string | null> {
  const value = imageBase64.trim();
  if (!value) return null;
  const match = value.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  const ext = match ? (match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()) : 'jpg';
  const data = match ? match[2] : value;
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length) return null;
  const filename = `${randomUUID()}.${ext}`;
  const file = getRelayFilePath(tenantId, filename);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  const base = getConfiguredAppUrl(request.nextUrl.origin);
  return `${base}/api/ai/image/file/${encodeURIComponent(filename)}${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`;
}

export async function POST(request: NextRequest) {
  if (!hasMountainViewBridgeAccess(request)) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  try {
    const parsed = relaySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid MountainView image relay payload', {
        status: 400,
        code: 'INVALID_BODY',
        details: parsed.error.flatten(),
      });
    }

    const body = parsed.data;
    const tenantId = body.tenantId || undefined;
    if (!tenantId) {
      return apiError('Tenant context required', { status: 400, code: 'TENANT_REQUIRED' });
    }
    const storedImageUrl = body.imageBase64 ? await persistBase64Image(body.imageBase64, tenantId, request) : null;
    const prompt = body.prompt?.trim() || '';
    const imageUrl = body.imageUrl || storedImageUrl || '';
    let imageCommand: unknown;

    if (prompt) {
      imageCommand = await runImageCommand(`!img ${prompt}`, tenantId || 'global');
    }

    const record: RelayRecord = {
      id: `mv_image_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      source: body.source || 'mountainview-ai',
      tenantId: tenantId || 'global',
      username: body.username || 'mountainview',
      imageUrl,
      storedImageUrl,
      prompt,
      metadata: body.metadata || {},
      imageCommand,
    };
    await appendRelayRecord(record);

    return apiOk({
      received: true,
      stored: Boolean(storedImageUrl),
      imageUrl,
      recordId: record.id,
      imageCommand,
    });
  } catch (error: any) {
    console.error('[MountainView Image Relay] Error:', error);
    return apiError(error?.message || 'MountainView image relay failed', {
      status: 500,
      code: 'MOUNTAINVIEW_IMAGE_RELAY_FAILED',
    });
  }
}
