import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import {
  deleteTenantDiscordMedia,
  getDiscordMediaPublicPath,
  importDiscordStreamHubMedia,
  isDiscordMediaSlot,
  writeDiscordMedia,
} from '@/lib/discord-media-store';
import {
  DISCORD_MEDIA_MAX_FILE_BYTES,
  DISCORD_MEDIA_MAX_FILE_MB,
  DISCORD_MEDIA_MAX_REQUEST_BYTES,
} from '@/lib/discord-media-limits';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { writeUserConfig } from '@/lib/user-config';
import { convertDiscordStreamHubMp4ToGif } from '@/services/discord-stream-hub';

function configKeyForSlot(slot: 'private-dm' | 'public-discord') {
  return slot === 'private-dm' ? 'PRIVATE_DM_GIF_URL' : 'PUBLIC_DISCORD_GIF_URL';
}

function canonicalMediaUrl(slot: 'private-dm' | 'public-discord', tenantId: string) {
  return `${getConfiguredAppUrl()}${getDiscordMediaPublicPath(slot, tenantId)}`;
}

async function persistCanonicalSlot(slot: 'private-dm' | 'public-discord', tenantId: string) {
  const url = canonicalMediaUrl(slot, tenantId);
  await writeUserConfig({ [configKeyForSlot(slot)]: url }, tenantId);
  return url;
}

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > DISCORD_MEDIA_MAX_REQUEST_BYTES) {
      return apiError(`GIF or MP4 uploads must be ${DISCORD_MEDIA_MAX_FILE_MB} MB or smaller`, {
        status: 413,
        code: 'FILE_TOO_LARGE',
      });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return apiError('Upload must be valid multipart form data', {
        status: 400,
        code: 'INVALID_MULTIPART',
      });
    }
    const file = formData.get('file') as File | null;
    const slot = formData.get('slot') as string;

    if (!file || !isDiscordMediaSlot(slot)) {
      return apiError('Missing file or invalid slot', { status: 400, code: 'INVALID_BODY' });
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'gif' && ext !== 'mp4') {
      return apiError('Only GIF and MP4 files are supported', { status: 400, code: 'INVALID_FILE' });
    }
    if (file.size > DISCORD_MEDIA_MAX_FILE_BYTES) {
      return apiError(`GIF or MP4 uploads must be ${DISCORD_MEDIA_MAX_FILE_MB} MB or smaller`, {
        status: 413,
        code: 'FILE_TOO_LARGE',
      });
    }

    if (ext === 'mp4') {
      const converted = await convertDiscordStreamHubMp4ToGif({
        bytes: Buffer.from(await file.arrayBuffer()),
        fileName: file.name,
        sessionToken: request.cookies.get('streamweaver-session')?.value || '',
        slot,
      });
      await importDiscordStreamHubMedia(slot, converted.url, session.tenantId);
      const url = await persistCanonicalSlot(slot, session.tenantId);
      return apiOk({
        success: true,
        url,
        filename: url.split('/').pop(),
        converted: true,
        source: 'streamweaver',
      });
    }

    const { filename } = await writeDiscordMedia(slot, Buffer.from(await file.arrayBuffer()), session.tenantId);
    const url = await persistCanonicalSlot(slot, session.tenantId);
    return apiOk({ success: true, url, filename, converted: false, source: 'streamweaver' });
  } catch (error: any) {
    console.error('[Discord Media API] Error:', error);
    return apiError(error?.message || 'Failed to save media', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }
    const slot = new URL(request.url).searchParams.get('slot') || '';
    if (!isDiscordMediaSlot(slot)) {
      return apiError('Invalid slot', { status: 400, code: 'INVALID_SLOT' });
    }

    const deleted = await deleteTenantDiscordMedia(slot, session.tenantId);
    await writeUserConfig({ [configKeyForSlot(slot)]: '' }, session.tenantId);
    return apiOk({ success: true, deleted, slot });
  } catch (error: any) {
    console.error('[Discord Media API] Delete error:', error);
    return apiError(error?.message || 'Failed to delete media', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
