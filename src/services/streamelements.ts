import crypto from 'node:crypto';
import { readJsonFile, writeJsonFile, type StorageContext } from './storage';
import { createCommand, getAllCommands } from '@/lib/commands-store';
import { applyLoyaltyImport } from './loyalty-import';
import { parseLoyaltyImport } from './loyalty-import-parser';

type StreamElementsToken = { accessToken: string; refreshToken?: string; expiresAt: number; scope?: string };
const API = 'https://api.streamelements.com/kappa/v2';
const tokenFile = 'streamelements-oauth.json';
const rawFile = 'streamelements-latest-import.json';

function ctx(tenantId: string, username: string): StorageContext { return { tenantId, username: username.toLowerCase() }; }
async function getToken(c: StorageContext): Promise<StreamElementsToken | null> { return readJsonFile<StreamElementsToken | null>(tokenFile, null, c); }
async function saveToken(token: StreamElementsToken, c: StorageContext) { await writeJsonFile(tokenFile, token, c); }
async function refresh(token: StreamElementsToken, c: StorageContext): Promise<StreamElementsToken> {
  if (token.expiresAt > Date.now() + 60_000) return token;
  const clientId = process.env.STREAMELEMENTS_CLIENT_ID;
  const clientSecret = process.env.STREAMELEMENTS_CLIENT_SECRET;
  if (!clientId || !clientSecret || !token.refreshToken) throw new Error('StreamElements OAuth is not configured or has expired. Reconnect StreamElements.');
  const response = await fetch('https://api.streamelements.com/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: token.refreshToken }) });
  if (!response.ok) throw new Error('StreamElements token refresh failed. Reconnect StreamElements.');
  const data = await response.json();
  const next = { accessToken: String(data.access_token), refreshToken: data.refresh_token || token.refreshToken, expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 604800) - 60) * 1000, scope: data.scope || token.scope };
  await saveToken(next, c); return next;
}
async function api(path: string, token: StreamElementsToken, c: StorageContext): Promise<any> {
  const current = await refresh(token, c);
  const response = await fetch(`${API}${path}`, { headers: { accept: 'application/json', Authorization: `OAuth ${current.accessToken}` }, cache: 'no-store' });
  if (response.status === 401) throw new Error('StreamElements authorization expired. Reconnect StreamElements.');
  if (!response.ok) return null;
  return response.json().catch(() => null);
}
function arrayFrom(value: any): any[] { return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : Array.isArray(value?.users) ? value.users : Array.isArray(value?.leaderboard) ? value.leaderboard : []; }
function usernameOf(row: any): string { return String(row?.username || row?.user || row?.login || row?.name || row?.userName || '').replace(/^@/, '').trim().toLowerCase(); }
function pointsOf(row: any): string | undefined { const value = row?.points ?? row?.pointsCurrent ?? row?.points_current ?? row?.balance; return value == null || value === '' ? undefined : String(value).replace(/,/g, '').split('.')[0]; }
function minutesOf(row: any): number | undefined { const value = row?.watchtime ?? row?.watchTime ?? row?.minutes ?? row?.watchMinutes ?? row?.time; const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined; }

export async function getStreamElementsStatus(c: StorageContext) { const token = await getToken(c); return { connected: Boolean(token), expiresAt: token?.expiresAt || null, scope: token?.scope || '' }; }
export async function saveStreamElementsToken(token: StreamElementsToken, c: StorageContext) { await saveToken(token, c); }
export async function importStreamElements(c: StorageContext) {
  const token = await getToken(c); if (!token) throw new Error('Connect StreamElements first.');
  const profile = await api('/channels/me', token, c);
  const channel = String(profile?.username || profile?.alias || c.username).toLowerCase();
  const [commands, defaults, timers, points, watchtime, stats, variables] = await Promise.all([
    api(`/bot/commands/${encodeURIComponent(channel)}`, token, c),
    api(`/bot/commands/${encodeURIComponent(channel)}/default`, token, c),
    api(`/bot/timers/${encodeURIComponent(channel)}`, token, c),
    api(`/points/${encodeURIComponent(channel)}/top`, token, c),
    api(`/points/${encodeURIComponent(channel)}/watchtime`, token, c),
    api(`/stats/${encodeURIComponent(channel)}`, token, c),
    api(`/bot/variables/${encodeURIComponent(channel)}`, token, c),
  ]);
  const importedCommands: string[] = [];
  const existing = new Set((await getAllCommands(c.tenantId)).map((x: any) => String(x.command || '').toLowerCase()));
  for (const raw of arrayFrom(commands)) {
    const commandText = String(raw?.command || '').trim(); if (!commandText) continue;
    const command = commandText.startsWith('!') ? commandText : `!${commandText}`;
    if (existing.has(command.toLowerCase())) continue;
    await createCommand({ name: command, command, enabled: raw.enabled !== false, description: raw.reply || raw.description || '', globalCooldown: Number(raw.cooldown?.global || 0), userCooldown: Number(raw.cooldown?.user || 0), aliases: Array.isArray(raw.aliases) ? raw.aliases : [], sources: 1 }, c.tenantId);
    existing.add(command.toLowerCase()); importedCommands.push(command);
  }
  const rows = [...arrayFrom(points), ...arrayFrom(watchtime)].map((row) => ({ username: usernameOf(row), points: pointsOf(row), watchtime: minutesOf(row) })).filter((row) => row.username && (row.points !== undefined || row.watchtime !== undefined));
  const csv = ['username,points,watchtime', ...rows.map((r) => `${r.username},${r.points ?? ''},${r.watchtime ?? ''}`)].join('\n');
  let loyalty: any = { imported: 0, skipped: true };
  if (rows.length) { const parsed = parseLoyaltyImport(csv, 'minutes', 'all'); loyalty = await applyLoyaltyImport(csv, 'minutes', parsed.digest, c, 'all'); }
  const snapshot = { fetchedAt: new Date().toISOString(), channel, commands: arrayFrom(commands), defaults: arrayFrom(defaults), timers: arrayFrom(timers), points: arrayFrom(points), watchtime: arrayFrom(watchtime), stats, variables, importedCommands, loyalty };
  await writeJsonFile(rawFile, snapshot, c);
  return { channel, importedCommands: importedCommands.length, importedWatchers: loyalty.imported || 0, timers: arrayFrom(timers).length, variables: arrayFrom(variables).length, pointsRows: arrayFrom(points).length, watchtimeRows: arrayFrom(watchtime).length, rawBackup: rawFile };
}
export function oauthState(): string { return crypto.randomBytes(32).toString('hex'); }
