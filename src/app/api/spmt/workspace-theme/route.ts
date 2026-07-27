import { NextRequest, NextResponse } from 'next/server';
import { workspaceThemeTokens } from '@spmt/sdk';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('streamweaver-spmt-token')?.value || '';
  if (!token) {
    return NextResponse.json({
      error: 'SpaceMountain connection expired',
      reconnectUrl: '/auth/spmt/start?next=/settings',
    }, { status: 401 });
  }

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const [profileResponse, overlayResponse] = await Promise.all([
    fetch(`${SPMT_BASE_URL}/api/workspace-profile`, { headers, cache: 'no-store' }),
    fetch(`${SPMT_BASE_URL}/api/overlay-workspace`, { headers, cache: 'no-store' }),
  ]);
  const [payload, overlayPayload] = await Promise.all([
    profileResponse.json().catch(() => null),
    overlayResponse.json().catch(() => null),
  ]);
  if (!profileResponse.ok || !payload?.profile) {
    const expired = profileResponse.status === 401 || profileResponse.status === 403;
    return NextResponse.json({
      error: expired ? 'SpaceMountain connection expired' : (payload?.error || 'Workspace theme unavailable'),
      ...(expired ? { reconnectUrl: '/auth/spmt/start?next=/settings' } : {}),
    }, { status: profileResponse.status || 502 });
  }

  return NextResponse.json({
    tokens: workspaceThemeTokens(payload.profile, 'streamweaver', overlayResponse.ok ? overlayPayload?.layout || null : null),
    revision: payload.profile.revision,
    updatedAt: payload.profile.updatedAt,
  });
}
