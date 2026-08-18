import { getSpmtServiceToken } from './spmt-service-token';

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

async function entitlementAuthorizationHeaders(): Promise<Record<string, string>> {
  try {
    const token = await getSpmtServiceToken(['entitlements:read']);
    return { Authorization: `Bearer ${token}` };
  } catch (error) {
    if (!LEGACY_SPMT_SYSTEM_KEY) throw error;
    console.warn('[auth-migration] LEGACY_AUTH_USED migration=AUTH-SW-003 route=/api/internal/easter-eggs/entitlement transport=x-spmt-key');
    return { 'x-spmt-key': LEGACY_SPMT_SYSTEM_KEY };
  }
}

export async function getSpmtEasterEggEntitlement(input: {
  provider: 'discord' | 'twitch';
  providerUserId: string;
}): Promise<SpmtEasterEggEntitlement> {
  const providerUserId = String(input.providerUserId || '').trim();
  if (!providerUserId) return EMPTY_ENTITLEMENT;

  try {
    const response = await fetch(`${SPMT_BASE_URL}/api/internal/easter-eggs/entitlement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await entitlementAuthorizationHeaders()),
      },
      body: JSON.stringify({ provider: input.provider, providerUserId }),
      cache: 'no-store',
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(4000)
        : undefined,
    });
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
