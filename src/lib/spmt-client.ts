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

function attemptSignal(timeoutMs: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}

async function fetchSpmtAttempt(
  url: string,
  init: RequestInit,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const { signal: _sharedSignal, ...baseInit } = init;
  return fetch(url, {
    ...baseInit,
    signal: attemptSignal(timeoutMs),
    headers: { ...((init.headers || {}) as Record<string, string>), ...headers },
  });
}

async function discardResponse(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The connection/body is already closed; retry can continue safely.
  }
}

async function fetchSpmtWithServiceAuth(
  scope: string,
  url: string,
  init: RequestInit,
  legacyHeaders: Record<string, string> | null,
  timeoutMs: number,
): Promise<Response> {
  let serviceError: unknown = null;
  try {
    let token = await getSpmtServiceToken([scope]);
    let response = await fetchSpmtAttempt(url, init, { Authorization: `Bearer ${token}` }, timeoutMs);

    // 403 is a real authorization decision from the receiver. Never escalate a
    // denied scoped request to a broader compatibility credential.
    if (response.status === 403) return response;

    if (response.status === 401) {
      await discardResponse(response);
      clearSpmtServiceTokenCache([scope]);
      token = await getSpmtServiceToken([scope]);
      response = await fetchSpmtAttempt(url, init, { Authorization: `Bearer ${token}` }, timeoutMs);
      if (response.status === 403) return response;
    }

    if (response.status !== 401) return response;
    await discardResponse(response);
    serviceError = new Error(`SPMT service token was not accepted for ${scope}`);
  } catch (error) {
    serviceError = error;
  }

  if (!legacyHeaders) {
    if (serviceError instanceof Error) throw serviceError;
    throw new Error(`SPMT service OAuth unavailable for ${scope}`);
  }
  console.warn(`[auth-migration] LEGACY_AUTH_USED caller=streamweaver scope=${scope} reason=service-auth-unavailable`);
  return fetchSpmtAttempt(url, init, legacyHeaders, timeoutMs);
}

export function isSpmtEnabled() {
  return Boolean(STREAMWEAVER_CLIENT_SECRET || SPMT_API_KEY || SPMT_SYSTEM_KEY);
}

export async function publishSpmtEvent(event: SpmtEventInput) {
  if (!STREAMWEAVER_CLIENT_SECRET && !SPMT_API_KEY) {
    return { skipped: true, reason: 'SPMT event service auth not configured' };
  }

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
      },
      SPMT_API_KEY ? { Authorization: `Bearer ${SPMT_API_KEY}` } : null,
      5000,
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
    },
    SPMT_SYSTEM_KEY ? { 'x-spmt-key': SPMT_SYSTEM_KEY } : null,
    8000,
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
