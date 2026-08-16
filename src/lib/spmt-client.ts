const SPMT_BASE_URL = process.env.SPMT_BASE_URL || 'https://spmt.live';
const SPMT_API_KEY = process.env.SPMT_API_KEY || '';
const SPMT_SYSTEM_KEY = process.env.SPMT_SYSTEM_KEY || '';

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

export function isSpmtEnabled() {
  return Boolean(SPMT_API_KEY);
}

export async function publishSpmtEvent(event: SpmtEventInput) {
  if (!SPMT_API_KEY) return { skipped: true, reason: 'SPMT_API_KEY not configured' };

  try {
    const response = await fetch(`${SPMT_BASE_URL.replace(/\/$/, '')}/api/platform/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SPMT_API_KEY}`,
      },
      body: JSON.stringify({
        sourceApp: 'streamweaver',
        visibility: 'creator',
        payload: {},
        ...event,
      }),
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(5000)
        : undefined,
    });

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
  if (!SPMT_SYSTEM_KEY) {
    throw new SpmtOwnerRecoveryError('SPMT owner recovery service is not configured', 503);
  }

  const response = await fetch(`${SPMT_BASE_URL.replace(/\/$/, '')}/api/internal/auth/admin-recovery-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-spmt-key': SPMT_SYSTEM_KEY,
    },
    body: JSON.stringify({
      requesterDiscordId: String(input.requesterDiscordId || '').trim(),
      targetDiscordId: String(input.targetDiscordId || '').trim(),
    }),
    cache: 'no-store',
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(8000)
      : undefined,
  });
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
