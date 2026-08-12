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
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(8000)
      : undefined;
    return Promise.all([
      fetch(`${SPMT_BASE_URL}/api/workspace-profile`, { headers, cache: 'no-store', signal }),
      fetch(`${SPMT_BASE_URL}/api/personal-overlay-launch`, { headers, cache: 'no-store', signal }),
    ]);
  };
  let [profileResponse, personalResponse] = await loadWorkspace(token);
  if (profileResponse.status === 401 || profileResponse.status === 403) {
    refreshed = await refreshSpmtConnection(request);
    if (refreshed) {
      token = refreshed.accessToken;
      [profileResponse, personalResponse] = await loadWorkspace(token);
    }
  }
  const [payload, personalPayload] = await Promise.all([
    profileResponse.json().catch(() => null),
    personalResponse.json().catch(() => null),
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
    // Public Overlay Bay is no longer locally re-rendered by app shells. The
    // canonical Personal renderer below is the only app-level overlay surface.
    tokens: workspaceThemeTokens(payload.profile, 'streamweaver', null),
    personalOverlayUrl: personalResponse.ok && typeof personalPayload?.url === 'string' ? personalPayload.url : null,
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
