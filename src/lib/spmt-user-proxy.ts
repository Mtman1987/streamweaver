import { NextRequest } from 'next/server';
import { refreshSpmtConnection, type RefreshedSpmtConnection } from '@/lib/spmt-oauth';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export type SpmtUserProxyResult = {
  response: Response | null;
  refreshed: RefreshedSpmtConnection | null;
};

function timeoutSignal() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(10_000)
    : undefined;
}

export async function fetchSpmtForUser(
  request: NextRequest,
  path: string,
  init: RequestInit = {},
): Promise<SpmtUserProxyResult> {
  let token = request.cookies.get('streamweaver-spmt-token')?.value || '';
  let refreshed: RefreshedSpmtConnection | null = null;

  if (!token) {
    refreshed = await refreshSpmtConnection(request);
    if (!refreshed) return { response: null, refreshed: null };
    token = refreshed.accessToken;
  }

  const call = (accessToken: string) => {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);
    if (!headers.has('Accept')) headers.set('Accept', '*/*');
    return fetch(`${SPMT_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: init.signal || timeoutSignal(),
    });
  };

  let response = await call(token);
  if (response.status === 401 || response.status === 403) {
    const nextRefresh = await refreshSpmtConnection(request);
    if (nextRefresh) {
      refreshed = nextRefresh;
      response = await call(nextRefresh.accessToken);
    }
  }

  return { response, refreshed };
}

export function spmtBaseUrl() {
  return SPMT_BASE_URL;
}
