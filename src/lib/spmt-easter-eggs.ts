const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');
const SPMT_SYSTEM_KEY = String(process.env.SPMT_SYSTEM_KEY || '').trim();

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

export async function getSpmtEasterEggEntitlement(input: {
  provider: 'discord' | 'twitch';
  providerUserId: string;
}): Promise<SpmtEasterEggEntitlement> {
  const providerUserId = String(input.providerUserId || '').trim();
  if (!SPMT_SYSTEM_KEY || !providerUserId) return EMPTY_ENTITLEMENT;

  try {
    const response = await fetch(`${SPMT_BASE_URL}/api/internal/easter-eggs/entitlement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-spmt-key': SPMT_SYSTEM_KEY,
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
