import type { NextRequest } from 'next/server';

function bearerToken(request: NextRequest): string {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

function configuredSecret(name: 'BOT_SECRET_KEY' | 'MOUNTAINVIEW_STREAMWEAVER_SECRET'): string {
  return String(process.env[name] || '').trim();
}

export function hasInternalServiceAccess(request: NextRequest): boolean {
  const expected = configuredSecret('BOT_SECRET_KEY');
  return Boolean(expected && bearerToken(request) === expected);
}

export function hasMountainViewBridgeAccess(request: NextRequest): boolean {
  if (request.headers.get('x-mountainview-bridge') !== '1') return false;
  const expected = configuredSecret('MOUNTAINVIEW_STREAMWEAVER_SECRET');
  return Boolean(expected && bearerToken(request) === expected);
}

export function internalServiceHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const secret = configuredSecret('BOT_SECRET_KEY');
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('BOT_SECRET_KEY is required for internal StreamWeaver requests');
  }
  return {
    ...headers,
    ...(secret ? { Authorization: 'Bearer ' + secret } : {}),
  };
}
