import { clearSpmtServiceTokenCache, getSpmtServiceToken } from './spmt-service-token';

const SPMT_BASE_URL = process.env.SPMT_BASE_URL || 'https://spmt.live';
const SPMT_API_KEY = process.env.SPMT_API_KEY || '';
const SPMT_SYSTEM_KEY = process.env.SPMT_SYSTEM_KEY || '';
const STREAMWEAVER_CLIENT_SECRET = process.env.STREAMWEAVER_CLIENT_SECRET || '';

export type SpmtEventVisibility = 'private' | 'creator' | 'community' | 'public' | 'system';

export type SpmtEventInput = {
  type: string;
  sourceApp?: string;
  visibility?: SpmtEventVisibility;
  actor?: {
    userId?: string;
    username?: string;
    displayName?: string;
  };
  payload?: Record<string, unknown>;
  links?: Array<{
    label: string;
    url: string;
    kind: 'launch' | 'details' | 'manage' | 'external';
  }>;
};

export type SpmtOwnerRecoveryResult = {
  ok: true;
  username: string;
  account: string;
  displayName: string;
  targetDiscordId: string;
  recoveryCode: string;
  issuedAt: string;
  instructions: string;
};

export class SpmtOwnerRecoveryError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SpmtOwnerRecoveryError';
    this.status = status;
  }
}

async function fetchSpmtWithServiceAuth(
  scope: string,
  url: string,
  init: RequestInit,
  legacyHeaders: Record<string, string> | null,
): Promise<Response> {
  let serviceError: unknown = null;
  try {
    let token = await getSpmtServiceToken([scope]);
    let response = await fetch(url, {
      ...init,
      headers: { ...((init.headers || {}) as Record<string, string>), Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) {
      clearSpmtServiceTokenCache();
      token = await getSpmtServiceToken([scope]);
      response = await fetch(url, {
        ...init,
        headers: { ...((init.headers || {}) as Record<string, string>), Authorization: `Bearer ${token}` },
      });
    }
    if (response.status !== 401 && response.status !== 403) return response;
    serviceError = new Error(`SPMT service token rejected for ${scope} (${response.status})`);
  } catch (error) {
    serviceError = error;
  }

  if (!legacyHeaders) {
    if (serviceError instanceof Error) throw serviceError;
    throw new Error(`SPMT service OAuth unavailable for ${scope}`);
  }
  console.warn(`[auth-migration] LEGACY_AUTH_USED caller=streamweaver scope=${scope}`);
  return fetch(url, {
    ...init,
    headers: { ...((init.headers || {}) as Record<string, string>), ...legacyHeaders },
  });
}

export function isSpmtEnabled() {
  return Boolean(STREAMWEAVER_CLIENT_SECRET || SPMT_API_KEY);
}

export async function publishSpmtEvent(event: SpmtEventInput) {
  if (!isSpmtEnabled()) return { skipped: true, reason: 'SPMT service auth not configured' };

  try {
    const response = await fetchSpmtWithServiceAuth(
      'events:write',
      `${SPMT_BASE_URL.replace(/\/$/, '')}/api/platform/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceApp: 'streamweaver',
          visibility: 'creator',
          payload: {},
          ...event,
        }),
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(5000)
          : undefined,
      },
      SPMT_API_KEY ? { Authorization: `Bearer ${SPMT_API_KEY}` } : null,
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn('[SPMT] event publish failed', JSON.stringify({ status: response.status, body }));
      return { skipped: false, ok: false, status: response.status };
    }

    return { skipped: false, ok: true };
  } catch (error) {
    console.warn('[SPMT] event publish error', error);
    return { skipped: false, ok: false };
  }
}

export async function requestSpmtOwnerRecoveryCode(input: {
  requesterDiscordId: string;
  targetDiscordId: string;
}): Promise<SpmtOwnerRecoveryResult> {
  if (!STREAMWEAVER_CLIENT_SECRET && !SPMT_SYSTEM_KEY) {
    throw new SpmtOwnerRecoveryError('SPMT owner recovery service is not configured', 503);
  }

  const response = await fetchSpmtWithServiceAuth(
    'account-recovery:write',
    `${SPMT_BASE_URL.replace(/\/$/, '')}/api/internal/auth/admin-recovery-code`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requesterDiscordId: String(input.requesterDiscordId || '').trim(),
        targetDiscordId: String(input.targetDiscordId || '').trim(),
      }),
      cache: 'no-store',
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(8000)
        : undefined,
    },
    SPMT_SYSTEM_KEY ? { 'x-spmt-key': SPMT_SYSTEM_KEY } : null,
  );
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok) {
    throw new SpmtOwnerRecoveryError(
      String(payload?.error || `SPMT owner recovery returned ${response.status}`),
      response.status,
    );
  }
  if (!payload?.ok || !payload?.account || !payload?.recoveryCode) {
    throw new SpmtOwnerRecoveryError('SPMT owner recovery returned an incomplete handoff', 502);
  }
  return payload as SpmtOwnerRecoveryResult;
}
