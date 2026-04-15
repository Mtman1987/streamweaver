/**
 * Extract tenantId from the streamweaver-session cookie on the client side.
 * Used by dashboard pages and overlays to identify to the WebSocket server.
 */
export function getClientTenantId(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.match(/streamweaver-session=([^;]+)/);
    if (!match) return null;
    const decoded = decodeURIComponent(match[1]);
    const session = JSON.parse(decoded);
    return session.id || null;
  } catch {
    return null;
  }
}

/**
 * Extract tenantId from URL query param (for overlay pages).
 */
export function getOverlayTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('tenant') || null;
}

/**
 * Get tenantId from either session cookie or URL param.
 */
export function getTenantId(): string | null {
  return getOverlayTenantId() || getClientTenantId();
}
