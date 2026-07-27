import { NextRequest, NextResponse } from 'next/server';
import { workspaceThemeTokens } from '@spmt/sdk';
import {
  applyRefreshedSpmtCookies,
  refreshSpmtConnection,
  type RefreshedSpmtConnection,
} from '@/lib/spmt-oauth';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let token = request.cookies.get('streamweaver-spmt-token')?.value || '';
  let refreshed: RefreshedSpmtConnection | null = null;
  if (!token) {
    refreshed = await refreshSpmtConnection(request);
    if (!refreshed) {
      return NextResponse.json({
        error: 'SpaceMountain connection expired',
        reconnectUrl: '/auth/spmt/start?next=/settings',
      }, { status: 401 });
    }
    token = refreshed.accessToken;
  }

  const loadWorkspace = (accessToken: string) => {
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
    return Promise.all([
      fetch(`${SPMT_BASE_URL}/api/workspace-profile`, { headers, cache: 'no-store' }),
      fetch(`${SPMT_BASE_URL}/api/overlay-workspace`, { headers, cache: 'no-store' }),
    ]);
  };
  let [profileResponse, overlayResponse] = await loadWorkspace(token);
  if (profileResponse.status === 401 || profileResponse.status === 403) {
    refreshed = await refreshSpmtConnection(request);
    if (refreshed) {
      token = refreshed.accessToken;
      [profileResponse, overlayResponse] = await loadWorkspace(token);
    }
  }
  const [payload, overlayPayload] = await Promise.all([
    profileResponse.json().catch(() => null),
    overlayResponse.json().catch(() => null),
  ]);
  if (!profileResponse.ok || !payload?.profile) {
    const expired = profileResponse.status === 401 || profileResponse.status === 403;
    const errorResponse = NextResponse.json({
      error: expired ? 'SpaceMountain connection expired' : (payload?.error || 'Workspace theme unavailable'),
      ...(expired ? { reconnectUrl: '/auth/spmt/start?next=/settings' } : {}),
    }, { status: profileResponse.status || 502 });
    if (refreshed) applyRefreshedSpmtCookies(errorResponse, refreshed);
    return errorResponse;
  }

  const response = NextResponse.json({
    tokens: workspaceThemeTokens(payload.profile, 'streamweaver', overlayResponse.ok ? overlayPayload?.layout || null : null),
    revision: payload.profile.revision,
    updatedAt: payload.profile.updatedAt,
    connection: {
      status: 'connected',
      renewable: Boolean(request.cookies.get('streamweaver-spmt-refresh')?.value || refreshed),
    },
  });
  if (refreshed) applyRefreshedSpmtCookies(response, refreshed);
  return response;
}
