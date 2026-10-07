import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tenantPath } from '../lib/tenant';

export type BotWakeAction = 'on' | 'off' | 'status';
export function parseBotWakeCommand(message: string): BotWakeAction | 'usage' | null {
  const match = String(message || '').trim().match(/^(?:!wake|!?@?spmt\s+wake)(?:\s+(.*))?$/i);
  if (!match) return null;
  const action = String(match[1] || 'on').trim().toLowerCase();
  return action === 'on' || action === 'off' || action === 'status' ? action : 'usage';
}
function wakePath(tenantId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(tenantId)) throw new Error('A registered tenant is required');
  return tenantPath(tenantId, 'data/shared-bot-wake.json');
}
/** Public per-tenant runtime state, persisted on the existing volume. */
export function isSharedBotAwake(tenantId?: string): boolean {
  if (!tenantId) return false;
  try { return JSON.parse(fs.readFileSync(wakePath(tenantId), 'utf8')).enabled === true; }
  catch { return false; }
}
export async function setSharedBotAwake(tenantId: string, enabled: boolean): Promise<void> {
  const file = wakePath(tenantId);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp.' + crypto.randomUUID();
  try {
    await fsp.writeFile(temp, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }) + '\n');
    await fsp.rename(temp, file);
  } finally { await fsp.unlink(temp).catch(() => {}); }
}
export function sharedBotChannelAllowed(input: {
  channel: string; communityBotLogin: string; tenantId?: string;
  registeredChannel?: string; mappedTenantId?: string; awake: boolean;
}): boolean {
  const channel = input.channel.replace(/^#/, '').trim().toLowerCase();
  if (!channel) return false;
  if (input.communityBotLogin && channel === input.communityBotLogin.toLowerCase()) return true;
  return Boolean(input.awake && input.tenantId && input.mappedTenantId === input.tenantId
    && channel === input.registeredChannel?.toLowerCase());
}
export async function handleBotWakeCommand(input: {
  message: string; tenantId?: string; channel: string; username: string;
  moderator: boolean; mirrored: boolean; botAuthored: boolean;
}, deps: {
  read: (tenantId: string) => boolean;
  write: (tenantId: string, enabled: boolean) => Promise<void>;
  acknowledge: (tenantId: string) => Promise<void>;
}): Promise<boolean> {
  const action = parseBotWakeCommand(input.message);
  if (!action) return false;
  if (!input.tenantId || input.mirrored || input.botAuthored
    || (!input.moderator && input.username.toLowerCase() !== input.channel.replace(/^#/, '').toLowerCase())) {
    return true; // No state change or outbound reply for an unauthorized control.
  }
  if (action === 'usage') return true;
  if (action !== 'status') await deps.write(input.tenantId, action === 'on');
  await deps.acknowledge(input.tenantId);
  return true;
}
