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
      // Keep this legacy Public read only for existing SDK/theme compatibility.
      // StreamWeaver no longer renders these widgets itself.
      fetch(`${SPMT_BASE_URL}/api/overlay-workspace`, { headers, cache: 'no-store', signal }),
      // Public tenant metadata supplies the clean copy/paste output URL pair.
      fetch(`${SPMT_BASE_URL}/api/tenant-scene?output=public`, { headers, cache: 'no-store', signal }),
      // The Personal launch route supplies the scoped renderer URL that does not
      // depend on a third-party SPMT cookie once it is inside the app shell.
      fetch(`${SPMT_BASE_URL}/api/personal-overlay-launch`, { headers, cache: 'no-store', signal }),
    ]);
  };
  let [profileResponse, overlayResponse, tenantResponse, personalLaunchResponse] = await loadWorkspace(token);
  if (profileResponse.status === 401 || profileResponse.status === 403) {
    refreshed = await refreshSpmtConnection(request);
    if (refreshed) {
      token = refreshed.accessToken;
      [profileResponse, overlayResponse, tenantResponse, personalLaunchResponse] = await loadWorkspace(token);
    }
  }
  const [payload, overlayPayload, tenantPayload, personalLaunchPayload] = await Promise.all([
    profileResponse.json().catch(() => null),
    overlayResponse.json().catch(() => null),
    tenantResponse.json().catch(() => null),
    personalLaunchResponse.json().catch(() => null),
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

  const tenant = tenantResponse.ok
    ? String(tenantPayload?.tenant || '')
    : (personalLaunchResponse.ok ? String(personalLaunchPayload?.tenant || '') : '');
  const tenantOutputs = tenantResponse.ok && tenantPayload?.urls ? tenantPayload.urls : null;
  const personalOverlayUrl = personalLaunchResponse.ok && typeof personalLaunchPayload?.url === 'string'
    ? personalLaunchPayload.url
    : '';
  const response = NextResponse.json({
    tokens: workspaceThemeTokens(payload.profile, 'streamweaver', overlayResponse.ok ? overlayPayload?.layout || null : null),
    revision: payload.profile.revision,
    updatedAt: payload.profile.updatedAt,
    tenant: tenant || null,
    tenantOutputs,
    personalOverlayUrl: personalOverlayUrl || null,
    connection: {
      status: 'connected',
      renewable: Boolean(request.cookies.get('streamweaver-spmt-refresh')?.value || refreshed),
    },
  });
  if (refreshed) applyRefreshedSpmtCookies(response, refreshed);
  return response;
}
