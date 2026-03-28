import { URL } from 'url';

const LOCAL_PORT = process.env.NEXT_PUBLIC_STREAMWEAVE_PORT || process.env.PORT || '3100';
const LOCAL_APP_URL = `http://127.0.0.1:${LOCAL_PORT}`;

function normalizeUrl(candidate?: string | null): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function extractHostname(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end > 0 ? trimmed.slice(1, end) : trimmed;
  }

  const firstColon = trimmed.indexOf(':');
  return firstColon === -1 ? trimmed : trimmed.slice(0, firstColon);
}

export function getConfiguredAppUrl(fallbackOrigin?: string | null): string {
  const candidates = [
    process.env.NEXT_PUBLIC_STREAMWEAVE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.APP_URL,
    process.env.PUBLIC_APP_URL,
    fallbackOrigin,
    LOCAL_APP_URL,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (normalized) return normalized;
  }

  return LOCAL_APP_URL;
}

export function getInternalAppUrl(): string {
  return LOCAL_APP_URL;
}

export function getOAuthRedirectUri(provider: 'twitch' | 'discord' | 'youtube', fallbackOrigin?: string | null): string {
  const explicit =
    provider === 'twitch'
      ? process.env.TWITCH_REDIRECT_URI
      : provider === 'discord'
        ? process.env.DISCORD_REDIRECT_URI
        : process.env.YOUTUBE_REDIRECT_URI;

  const normalizedExplicit = normalizeUrl(explicit);
  if (normalizedExplicit) return normalizedExplicit;

  return `${getConfiguredAppUrl(fallbackOrigin)}/auth/${provider}/callback`;
}

export function getAllowedHostnames(extraHosts: string[] = []): Set<string> {
  const hostnames = new Set<string>(['127.0.0.1', 'localhost', '::1']);
  const candidates = [
    process.env.NEXT_PUBLIC_STREAMWEAVE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.APP_URL,
    process.env.PUBLIC_APP_URL,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (!normalized) continue;

    try {
      hostnames.add(new URL(normalized).hostname.toLowerCase());
    } catch {
      // Ignore malformed env values.
    }
  }

  const wsHost = extractHostname(process.env.NEXT_PUBLIC_STREAMWEAVE_WS_HOST || '');
  if (wsHost) {
    hostnames.add(wsHost);
  }

  for (const host of extraHosts) {
    const normalizedHost = extractHostname(host);
    if (normalizedHost) {
      hostnames.add(normalizedHost);
    }
  }

  return hostnames;
}

export function isAllowedHost(host: string, extraHosts: string[] = []): boolean {
  const hostname = extractHostname(host);
  if (!hostname) return false;
  return getAllowedHostnames(extraHosts).has(hostname);
}

export function isAllowedOrigin(origin?: string | null, extraHosts: string[] = []): boolean {
  if (!origin) return true;

  try {
    return isAllowedHost(new URL(origin).host, extraHosts);
  } catch {
    return false;
  }
}
