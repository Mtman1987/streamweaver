import { listTenants } from '@/lib/tenant';
import { getStoredTokens, isTwitchCredentialQuarantined } from '@/lib/token-utils.server';
import { internalServiceHeaders } from '@/lib/internal-service-auth';
import { incrementWatchtime } from './user-stats';

// A quarantined refresh token cannot recover by polling again every minute.
// Keep one actionable warning per tenant until its credential state changes.
const warnedReauthorizationTenants = new Set<string>();
export async function runWatchtimeTracker(uiPort: number | string, deps = { listTenants, getStoredTokens, isTwitchCredentialQuarantined, internalServiceHeaders, incrementWatchtime, fetch: globalThis.fetch }) {
  for (const tenantId of await deps.listTenants()) {
    try {
      const tokens = await deps.getStoredTokens(tenantId);
      if (deps.isTwitchCredentialQuarantined(tokens, 'broadcaster')) {
        if (!warnedReauthorizationTenants.has(tenantId)) {
          console.warn('[Watchtime:' + tenantId + '] Twitch broadcaster credentials require re-authorization; watchtime polling paused until credentials are renewed.');
          warnedReauthorizationTenants.add(tenantId);
        }
        continue;
      }
      warnedReauthorizationTenants.delete(tenantId);
      const username = String(tokens?.broadcasterUsername || '').trim().toLowerCase();
      if (!username) continue;
      const response = await deps.fetch('http://127.0.0.1:' + uiPort + '/api/chat/chatters?tenant=' + encodeURIComponent(tenantId) + '&tracking=1', { headers: deps.internalServiceHeaders(), signal: AbortSignal.timeout(20_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chatters request returned ' + response.status);
      const names = [...new Set<string>((Array.isArray(data.chatters) ? data.chatters : []).map((c: any) => String(c.user_login || c.user_name || '').trim().toLowerCase()).filter(Boolean))];
      if (names.length) await deps.incrementWatchtime(names, username, { tenantId, username });
    } catch (error) { console.warn('[Watchtime:' + tenantId + '] ' + (error instanceof Error ? error.message : String(error))); }
  }
}
