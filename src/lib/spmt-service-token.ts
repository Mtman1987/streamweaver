const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');
const TOKEN_TIMEOUT_MS = 3000;
const FAILURE_BACKOFF_MS = 15_000;
const FRESHNESS_MARGIN_MS = 30_000;

type ServiceTokenCache = {
  token: string;
  expiresAt: number;
  scopes: string[];
};

type FailureCache = {
  until: number;
  message: string;
};

const cached = new Map<string, ServiceTokenCache>();
const inFlight = new Map<string, Promise<string>>();
const failures = new Map<string, FailureCache>();

function normalizedScopes(scopes: string[]): string[] {
  return Array.from(new Set(scopes.map((value) => String(value || '').trim()).filter(Boolean))).sort();
}

function scopeKey(scopes: string[]): string {
  return scopes.join(' ');
}

function grantedScopes(payload: any, requested: string[]): string[] {
  if (Array.isArray(payload?.scopes)) return normalizedScopes(payload.scopes.map(String));
  if (typeof payload?.scope === 'string') return normalizedScopes(payload.scope.split(/\s+/));
  return requested;
}

async function mintSpmtServiceToken(requested: string[], key: string): Promise<string> {
  const clientSecret = String(process.env.STREAMWEAVER_CLIENT_SECRET || '').trim();
  if (!clientSecret) throw new Error('STREAMWEAVER_CLIENT_SECRET is not configured for SPMT service auth');

  try {
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
        scope: key,
      }),
      cache: 'no-store',
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(TOKEN_TIMEOUT_MS)
        : undefined,
    });

    const payload = await response.json().catch(() => null) as any;
    if (!response.ok || !payload?.access_token) {
      throw new Error(String(payload?.error || `SPMT service token exchange failed (${response.status})`));
    }

    const now = Date.now();
    const expiresIn = Math.max(60, Number(payload.expires_in || 3600));
    const entry = {
      token: String(payload.access_token),
      expiresAt: now + expiresIn * 1000,
      scopes: grantedScopes(payload, requested),
    };
    cached.set(key, entry);
    failures.delete(key);
    return entry.token;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.set(key, { until: Date.now() + FAILURE_BACKOFF_MS, message });
    throw error;
  }
}

export async function getSpmtServiceToken(scopes: string[]): Promise<string> {
  const requested = normalizedScopes(scopes);
  if (!requested.length) throw new Error('At least one SPMT service scope is required');

  const key = scopeKey(requested);
  const now = Date.now();
  const current = cached.get(key);
  if (current && current.expiresAt - now > FRESHNESS_MARGIN_MS) return current.token;

  const failed = failures.get(key);
  if (failed && failed.until > now) {
    throw new Error(`SPMT service token exchange is backing off after a recent failure: ${failed.message}`);
  }
  if (failed) failures.delete(key);

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = mintSpmtServiceToken(requested, key)
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

export function clearSpmtServiceTokenCache(scopes?: string[]) {
  if (!scopes?.length) {
    cached.clear();
    failures.clear();
    return;
  }
  const key = scopeKey(normalizedScopes(scopes));
  cached.delete(key);
  failures.delete(key);
}
