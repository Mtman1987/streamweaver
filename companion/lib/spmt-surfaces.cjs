'use strict';

const DEFAULT_ORIGIN = 'https://spmt.live';

function surfaceList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.surfaces)) return payload.surfaces;
  return [];
}

function buildSurfaceUrl(payload, id, appId = 'companion', origin = DEFAULT_ORIGIN) {
  const surface = surfaceList(payload).find((item) => String(item?.id || '') === String(id || ''));
  const raw = String(surface?.url || surface?.path || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, origin);
    url.searchParams.set('app', appId);
    url.searchParams.set('mode', id === 'worktray' ? 'panel' : 'full');
    if (id === 'overlays') url.searchParams.set('output', 'personal');
    return url.toString();
  } catch {
    return '';
  }
}

async function fetchJson(session, url) {
  const response = await session.fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || `SPMT request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function resolveSurfaceUrl(session, id, appId = 'companion', origin = DEFAULT_ORIGIN) {
  const payload = await fetchJson(session, `${String(origin).replace(/\/$/, '')}/api/platform/surfaces`);
  return buildSurfaceUrl(payload, id, appId, origin);
}

async function resolvePersonalOverlayUrl(session, origin = DEFAULT_ORIGIN) {
  const payload = await fetchJson(session, `${String(origin).replace(/\/$/, '')}/api/personal-overlay-launch`);
  return String(payload?.url || '').trim();
}

module.exports = {
  DEFAULT_ORIGIN,
  buildSurfaceUrl,
  resolveSurfaceUrl,
  resolvePersonalOverlayUrl,
  surfaceList,
};
