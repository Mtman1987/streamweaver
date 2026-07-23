import type { NextRequest } from 'next/server';

function bearerToken(request: NextRequest): string {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

function configuredSecret(name: 'BOT_SECRET_KEY' | 'MOUNTAINVIEW_STREAMWEAVER_SECRET' | 'STREAMWEAVER_SECRET' | 'STREAMWEAVER_CLIENT_SECRET' | 'DSH_SERVICE_SECRET' | 'DSH_CLIENT_SECRET'): string {
  return String(process.env[name] || '').trim();
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function getInternalServiceSecrets(): string[] {
  return uniqueNonEmpty([
    configuredSecret('BOT_SECRET_KEY'),
    configuredSecret('STREAMWEAVER_SECRET'),
    configuredSecret('STREAMWEAVER_CLIENT_SECRET'),
    configuredSecret('DSH_SERVICE_SECRET'),
    configuredSecret('DSH_CLIENT_SECRET'),
  ]);
}

export function isKnownInternalSecret(secret: string): boolean {
  const supplied = String(secret || '').trim();
  if (!supplied) return false;
  return getInternalServiceSecrets().includes(supplied);
}

export function extractInternalServiceSecret(request: NextRequest): string {
  const bearer = bearerToken(request);
  if (bearer) return bearer;
  return String(request.headers.get('x-bot-secret') || '').trim();
}

export function hasInternalServiceAccess(request: NextRequest): boolean {
  return isKnownInternalSecret(extractInternalServiceSecret(request));
}

export function isMountainViewBridgeSecretEnforced(): boolean {
  return String(process.env.MOUNTAINVIEW_BRIDGE_ENFORCE_SECRET || '').trim() === 'true';
}

export function hasMountainViewBridgeAccess(request: NextRequest): boolean {
  if (request.headers.get('x-mountainview-bridge') !== '1') return false;
  // Default: trust the bridge header alone so the bridge works without
  // provisioning a shared secret. Set MOUNTAINVIEW_BRIDGE_ENFORCE_SECRET=true
  // to require a matching MOUNTAINVIEW_STREAMWEAVER_SECRET bearer token.
  if (!isMountainViewBridgeSecretEnforced()) return true;
  const expected = configuredSecret('MOUNTAINVIEW_STREAMWEAVER_SECRET');
  return Boolean(expected && bearerToken(request) === expected);
}

export function internalServiceHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const secret = configuredSecret('BOT_SECRET_KEY') || configuredSecret('STREAMWEAVER_SECRET');
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('BOT_SECRET_KEY is required for internal StreamWeaver requests');
  }
  return {
    ...headers,
    ...(secret ? { Authorization: 'Bearer ' + secret } : {}),
  };
}
