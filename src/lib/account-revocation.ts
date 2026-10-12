import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Owner-managed revocations live on the persistent volume, never in credentials.
const revocationFile = resolve(process.env.PERSIST_ROOT || resolve(process.cwd(), 'data/runtime'), 'global/revoked-accounts.json');
export function isAccountRevoked(identity: Record<string, unknown> | null | undefined): boolean {
  if (!identity) return false;
  try {
    const state = JSON.parse(readFileSync(revocationFile, 'utf8'));
    const ids = new Set((state.ids || []).map(String));
    const logins = new Set((state.logins || []).map((v: unknown) => String(v).trim().toLowerCase().replace(/^[@#]+/, '')));
    return ['id', 'tenantId', 'spmtUserId', 'twitchId', 'twitch_id', 'discordId', 'discord_id'].some(k => ids.has(String(identity[k] || '')))
      || ['username', 'twitchUsername', 'twitch_username', 'broadcasterUsername'].some(k => logins.has(String(identity[k] || '').trim().toLowerCase().replace(/^[@#]+/, '')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    // An unreadable revocation registry must never restore a removed account.
    return true;
  }
}
