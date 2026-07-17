import { NextRequest, NextResponse } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { getDiscordMediaPublicPath, isDiscordMediaSlot, writeDiscordMedia } from '@/lib/discord-media-store';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const slot = formData.get('slot') as string;

    if (!file || !isDiscordMediaSlot(slot)) {
      return apiError('Missing file or invalid slot', { status: 400, code: 'INVALID_BODY' });
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'gif') {
      return apiError('Only GIF files are supported', { status: 400, code: 'INVALID_FILE' });
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
