import { clearSpmtServiceTokenCache, getSpmtServiceToken } from './spmt-service-token';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');
const LEGACY_SPMT_SYSTEM_KEY = String(process.env.SPMT_SYSTEM_KEY || '').trim();

export type SpmtEasterEggEntitlement = {
  knownIdentity: boolean;
  eggs: {
    rocket: boolean;
    blackHole: boolean;
    signal: boolean;
  };
  title: 'Voidwalker' | null;
};

const EMPTY_ENTITLEMENT: SpmtEasterEggEntitlement = {
  knownIdentity: false,
  eggs: { rocket: false, blackHole: false, signal: false },
  title: null,
};

function logLegacyFallback(reason: string) {
  console.warn(`[auth-migration] LEGACY_AUTH_USED migration=AUTH-SW-003 route=/api/internal/easter-eggs/entitlement transport=x-spmt-key reason=${reason}`);
}

async function postEntitlement(
  input: { provider: 'discord' | 'twitch'; providerUserId: string },
  authorization: Record<string, string>,
): Promise<Response> {
  return fetch(`${SPMT_BASE_URL}/api/internal/easter-eggs/entitlement`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authorization,
    },
    body: JSON.stringify(input),
    cache: 'no-store',
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(4000)
      : undefined,
  });
}

async function legacyEntitlementRequest(
  input: { provider: 'discord' | 'twitch'; providerUserId: string },
  reason: string,
): Promise<Response | null> {
  if (!LEGACY_SPMT_SYSTEM_KEY) return null;
  logLegacyFallback(reason);
  return postEntitlement(input, { 'x-spmt-key': LEGACY_SPMT_SYSTEM_KEY });
}

export async function getSpmtEasterEggEntitlement(input: {
  provider: 'discord' | 'twitch';
  providerUserId: string;
}): Promise<SpmtEasterEggEntitlement> {
  const providerUserId = String(input.providerUserId || '').trim();
  if (!providerUserId) return EMPTY_ENTITLEMENT;
  const requestInput = { provider: input.provider, providerUserId };

  try {
    let response: Response;
    try {
      const token = await getSpmtServiceToken(['entitlements:read']);
      response = await postEntitlement(requestInput, { Authorization: `Bearer ${token}` });
    } catch {
      const legacy = await legacyEntitlementRequest(requestInput, 'service-token-unavailable');
      if (!legacy) return EMPTY_ENTITLEMENT;
      response = legacy;
    }

    if ((response.status === 401 || response.status === 403) && LEGACY_SPMT_SYSTEM_KEY) {
      clearSpmtServiceTokenCache();
      const legacy = await legacyEntitlementRequest(requestInput, `service-token-rejected-${response.status}`);
      if (legacy) response = legacy;
    }

    if (!response.ok) return EMPTY_ENTITLEMENT;
    const payload = await response.json().catch(() => null) as any;
    return {
      knownIdentity: payload?.knownIdentity === true,
      eggs: {
        rocket: payload?.eggs?.rocket === true,
        blackHole: payload?.eggs?.blackHole === true,
        signal: payload?.eggs?.signal === true,
      },
      title: payload?.title === 'Voidwalker' ? 'Voidwalker' : null,
    };
  } catch {
    return EMPTY_ENTITLEMENT;
  }
}
