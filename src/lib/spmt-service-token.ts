const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

type ServiceTokenCache = {
  token: string;
  expiresAt: number;
  scopes: string[];
};

let cached: ServiceTokenCache | null = null;

function normalizedScopes(scopes: string[]): string[] {
  return Array.from(new Set(scopes.map((value) => String(value || '').trim()).filter(Boolean))).sort();
}

export async function getSpmtServiceToken(scopes: string[]): Promise<string> {
  const requested = normalizedScopes(scopes);
  if (!requested.length) throw new Error('At least one SPMT service scope is required');

  const now = Date.now();
  if (cached && cached.expiresAt - now > 60_000 && requested.every((scope) => cached!.scopes.includes(scope))) {
    return cached.token;
  }

  const clientSecret = String(process.env.STREAMWEAVER_CLIENT_SECRET || '').trim();
  if (!clientSecret) throw new Error('STREAMWEAVER_CLIENT_SECRET is not configured for SPMT service auth');

  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: 'streamweaver',
      client_secret: clientSecret,
      scope: requested.join(' '),
    }),
    cache: 'no-store',
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(8000)
      : undefined,
  });

  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.access_token) {
    throw new Error(String(payload?.error || `SPMT service token exchange failed (${response.status})`));
  }

  const expiresIn = Math.max(60, Number(payload.expires_in || 3600));
  cached = {
    token: String(payload.access_token),
    expiresAt: now + expiresIn * 1000,
    scopes: requested,
  };
  return cached.token;
}

export function clearSpmtServiceTokenCache() {
  cached = null;
}
