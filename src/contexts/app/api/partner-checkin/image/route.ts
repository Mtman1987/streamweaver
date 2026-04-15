import { NextRequest, NextResponse } from 'next/server';
import { getPartnerById } from '@/services/partner-checkin';
import { getConfigSection } from '@/lib/local-config/service';
import { apiError } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return apiError('Missing id', { status: 400, code: 'MISSING_ID' });

  const cfg = await getConfigSection('redeems');
  const { discordGuildId, discordRoleName } = cfg.partnerCheckin;
  if (!discordGuildId || !discordRoleName) return apiError('Not configured', { status: 500, code: 'NOT_CONFIGURED' });

  const partner = await getPartnerById(parseInt(id), discordGuildId, discordRoleName);
  if (!partner) return apiError('Partner not found', { status: 404, code: 'PARTNER_NOT_FOUND' });

  try {
    const res = await fetch(partner.avatarUrl);
    if (!res.ok) return apiError('Avatar fetch failed', { status: 502, code: 'AVATAR_FETCH_FAILED' });

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/png';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[Partner Checkin] Avatar proxy error:', error);
    return apiError('Avatar not available', { status: 502, code: 'AVATAR_ERROR' });
  }
}
