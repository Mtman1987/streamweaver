import { NextRequest, NextResponse } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { getDiscordMediaPublicPath, isDiscordMediaSlot, writeDiscordMedia } from '@/lib/discord-media-store';
import {
  DISCORD_MEDIA_MAX_FILE_BYTES,
  DISCORD_MEDIA_MAX_FILE_MB,
  DISCORD_MEDIA_MAX_REQUEST_BYTES,
} from '@/lib/discord-media-limits';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { convertDiscordStreamHubMp4ToGif } from '@/services/discord-stream-hub';

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
      const buffer = Buffer.from(await file.arrayBuffer());
      const converted = await convertDiscordStreamHubMp4ToGif({
        bytes: buffer,
        fileName: file.name,
        sessionToken: request.cookies.get('streamweaver-session')?.value || '',
        slot,
      });
      return apiOk({ success: true, url: converted.url, filename: converted.url.split('/').pop(), converted: true });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { filename } = await writeDiscordMedia(slot, buffer, session.tenantId);

    const baseUrl = getConfiguredAppUrl();
    const publicUrl = `${baseUrl}${getDiscordMediaPublicPath(slot, session.tenantId)}`;

    return apiOk({ success: true, url: publicUrl, filename });
  } catch (error: any) {
    console.error('[Discord Media API] Error:', error);
    return apiError(error?.message || 'Failed to save media', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
