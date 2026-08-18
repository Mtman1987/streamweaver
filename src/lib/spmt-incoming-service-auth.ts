import crypto from 'node:crypto';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');
const LEGACY_SPMT_SYSTEM_KEY = String(process.env.SPMT_SYSTEM_KEY || process.env.SYSTEM_API_KEY || '').trim();
const SERVICEINFO_TIMEOUT_MS = 3000;
const SERVICEINFO_CACHE_MS = 30_000;
const LEGACY_LOG_INTERVAL_MS = 60_000;

type ServiceInfo = {
  client_id: string;
  token_use: string;
  scopes: string[];
};

type CachedServiceInfo = {
  expiresAt: number;
  info: ServiceInfo;
};

type Inspection =
  | { kind: 'valid'; info: ServiceInfo }
  | { kind: 'invalid' }
  | { kind: 'unavailable' };

const serviceInfoCache = new Map<string, CachedServiceInfo>();
const inFlight = new Map<string, Promise<Inspection>>();
const lastLegacyLogAt = new Map<string, number>();

function tokenFingerprint(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function timingSafeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function inspectSpmtServiceBearer(token: string): Promise<Inspection> {
  const fingerprint = tokenFingerprint(token);
  const now = Date.now();
  const cached = serviceInfoCache.get(fingerprint);
  if (cached && cached.expiresAt > now) return { kind: 'valid', info: cached.info };
  if (cached) serviceInfoCache.delete(fingerprint);

  const pending = inFlight.get(fingerprint);
  if (pending) return pending;

  const inspection = (async (): Promise<Inspection> => {
    try {
      const response = await fetch(`${SPMT_BASE_URL}/api/oauth/serviceinfo`, {
        headers: {
          Authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
        cache: 'no-store',
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(SERVICEINFO_TIMEOUT_MS)
          : undefined,
      });
      if (response.status === 401 || response.status === 403) return { kind: 'invalid' };
      if (!response.ok) return { kind: 'unavailable' };
      const payload = await response.json().catch(() => null) as any;
      const info: ServiceInfo = {
        client_id: String(payload?.client_id || '').trim(),
        token_use: String(payload?.token_use || '').trim(),
        scopes: Array.isArray(payload?.scopes) ? payload.scopes.map(String) : [],
      };
      if (!info.client_id || info.token_use !== 'client_credentials') return { kind: 'invalid' };
      serviceInfoCache.set(fingerprint, { info, expiresAt: Date.now() + SERVICEINFO_CACHE_MS });
      return { kind: 'valid', info };
    } catch {
      return { kind: 'unavailable' };
    }
  })().finally(() => {
    inFlight.delete(fingerprint);
  });

  inFlight.set(fingerprint, inspection);
  return inspection;
}

function legacyAuthorized(request: Request, scope: string) {
  if (!LEGACY_SPMT_SYSTEM_KEY) return false;
  const provided = String(request.headers.get('x-spmt-key') || '').trim();
  if (!provided || !timingSafeEqual(provided, LEGACY_SPMT_SYSTEM_KEY)) return false;
  const now = Date.now();
  const last = lastLegacyLogAt.get(scope) || 0;
  if (now - last >= LEGACY_LOG_INTERVAL_MS) {
    lastLegacyLogAt.set(scope, now);
    console.warn(`[auth-migration] LEGACY_AUTH_USED caller=spmt-core scope=${scope} transport=x-spmt-key`);
  }
  return true;
}

export async function authorizeSpmtCoreService(request: Request, requiredScope: string): Promise<boolean> {
  const authorization = String(request.headers.get('authorization') || '').trim();
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';

  if (bearer) {
    const inspection = await inspectSpmtServiceBearer(bearer);
    if (inspection.kind === 'valid') {
      // A valid-but-underprivileged machine token is a real authorization
      // denial. Never widen it by falling back to a shared compatibility key.
      return inspection.info.client_id === 'spmt-core'
        && inspection.info.scopes.includes(requiredScope);
    }
    if (inspection.kind === 'invalid') return false;
    // Temporary serviceinfo failure may use the compatibility lane during the
    // migration window, but only if the caller also supplied the legacy key.
  }

  return legacyAuthorized(request, requiredScope);
}

export function clearSpmtIncomingServiceAuthCache() {
  serviceInfoCache.clear();
  inFlight.clear();
}
