import { NextRequest, NextResponse } from 'next/server';
import { validateLocalApiKey } from './service';

const MAX_CONTENT_LENGTH_BYTES = 5 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_GET_REQUESTS = 300;
const RATE_LIMIT_MUTATION_REQUESTS = 120;
const RATE_LIMIT_AUTH_REQUESTS = 60;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function pruneRateLimitBuckets(now: number): void {
  if (rateLimitBuckets.size < 2000) return;
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function extractHostname(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return '';

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end > 0) return trimmed.slice(1, end);
    return trimmed;
  }

  const firstColon = trimmed.indexOf(':');
  if (firstColon === -1) return trimmed;
  return trimmed.slice(0, firstColon);
}

function isLoopbackHost(host: string): boolean {
  const hostname = extractHostname(host);
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function clientAddress(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for') || '';
  const first = forwardedFor.split(',')[0]?.trim();
  return first || 'local';
}

function enforceContentLengthLimit(method: string, headers: Headers): NextResponse | null {
  if (!['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) return null;

  const raw = headers.get('content-length');
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  if (parsed > MAX_CONTENT_LENGTH_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  return null;
}

function resolveRateLimitMax(method: string, pathname: string): number {
  const normalizedMethod = method.toUpperCase();
  if (pathname.startsWith('/api/auth/')) return RATE_LIMIT_AUTH_REQUESTS;
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS') {
    return RATE_LIMIT_GET_REQUESTS;
  }
  return RATE_LIMIT_MUTATION_REQUESTS;
}

function enforceRateLimit(method: string, pathname: string, headers: Headers): NextResponse | null {
  const now = Date.now();
  pruneRateLimitBuckets(now);

  const key = `${clientAddress(headers)}:${method.toUpperCase()}:${pathname}`;
  const maxRequests = resolveRateLimitMax(method, pathname);
  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }

  if (existing.count >= maxRequests) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  existing.count += 1;
  return null;
}

function runRequestGuards(method: string, pathname: string, headers: Headers): NextResponse | null {
  const sizeDenied = enforceContentLengthLimit(method, headers);
  if (sizeDenied) return sizeDenied;

  return enforceRateLimit(method, pathname, headers);
}

export function requestApiKey(request: NextRequest): string {
  const headerKey = request.headers.get('x-api-key');
  if (headerKey) return headerKey;

  if (process.env.STREAMWEAVER_ALLOW_QUERY_API_KEY === 'true') {
    return request.nextUrl.searchParams.get('apiKey') || '';
  }

  return '';
}

export async function requireLocalApiAuth(request: NextRequest): Promise<NextResponse | null> {
  const host = request.headers.get('host') || '';
  if (!isLoopbackHost(host)) {
    return NextResponse.json({ error: 'Forbidden host' }, { status: 403 });
  }

  const deniedByGuards = runRequestGuards(request.method, request.nextUrl.pathname, request.headers);
  if (deniedByGuards) return deniedByGuards;

  const ok = await validateLocalApiKey(requestApiKey(request));
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

export function requestApiKeyFromRequest(request: Request): string {
  const headerKey = request.headers.get('x-api-key');
  if (headerKey) return headerKey;

  if (process.env.STREAMWEAVER_ALLOW_QUERY_API_KEY !== 'true') {
    return '';
  }

  try {
    const parsed = new URL(request.url);
    return parsed.searchParams.get('apiKey') || '';
  } catch {
    return '';
  }
}

export async function requireLocalApiAuthRequest(request: Request): Promise<NextResponse | null> {
  const host = request.headers.get('host') || '';
  if (!isLoopbackHost(host)) {
    return NextResponse.json({ error: 'Forbidden host' }, { status: 403 });
  }

  let pathname = '/api/unknown';
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    // Keep fallback pathname if URL parsing fails.
  }

  const deniedByGuards = runRequestGuards(request.method, pathname, request.headers);
  if (deniedByGuards) return deniedByGuards;

  const ok = await validateLocalApiKey(requestApiKeyFromRequest(request));
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
