import { URL } from 'url';
import { getKnownAppUrls, getLoopbackAppUrl, getRuntimeAppUrl } from './app-urls';

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

function normalizeLocalOrigin(candidate?: string | null): string | null {
  const normalized = normalizeUrl(candidate);
  if (!normalized) return null;

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
      ? normalized
      : null;
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
  const localAppUrl = getInternalAppUrl();
  const candidates = [
    normalizeLocalOrigin(fallbackOrigin),
    getRuntimeAppUrl(),
    localAppUrl,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (normalized) return normalized;
  }

  return localAppUrl;
}

export function getInternalAppUrl(): string {
  return getLoopbackAppUrl(process.env.PORT);
}

export function getOAuthRedirectUri(provider: 'twitch' | 'discord' | 'youtube' | 'kick', fallbackOrigin?: string | null): string {
  const explicit =
    provider === 'twitch'
      ? process.env.TWITCH_REDIRECT_URI
      : provider === 'discord'
        ? process.env.DISCORD_REDIRECT_URI
        : provider === 'kick'
          ? process.env.KICK_REDIRECT_URI
          : process.env.YOUTUBE_REDIRECT_URI;

  const normalizedExplicit = normalizeUrl(explicit);
  if (normalizedExplicit) return normalizedExplicit;

  return `${getConfiguredAppUrl(fallbackOrigin)}/api/auth/${provider}/callback`;
}

export function getAllowedHostnames(extraHosts: string[] = []): Set<string> {
  const hostnames = new Set<string>(['127.0.0.1', 'localhost', '::1']);
  const candidates = getKnownAppUrls();

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
