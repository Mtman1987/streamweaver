import fs from 'fs';
import path from 'path';
import { tenantPath } from '../lib/tenant';

function statsFile(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/checkin-stats.json');
  return path.join(process.cwd(), 'data', 'checkin-stats.json');
}

function overridesFile(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/partner-overrides.json');
  return path.join(process.cwd(), 'data', 'partner-overrides.json');
}

interface CheckinStats {
  userCounts: Record<string, number>;
  partnerCounts: Record<string, number>;
  sourceCounts?: Record<string, number>;
  displayCounts?: Record<string, number>;
}

type PartnerOverrides = Record<string, { inviteLink?: string }>;

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return fallback; }
}

function writeJson(file: string, data: unknown): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function recordCheckin(username: string, partnerName: string, tenantId?: string): { userTotal: number; partnerTotal: number } {
  const stats = readJson<CheckinStats>(statsFile(tenantId), { userCounts: {}, partnerCounts: {} });
  const userKey = username.toLowerCase();
  const partnerKey = partnerName.toLowerCase();
  stats.userCounts[userKey] = (stats.userCounts[userKey] || 0) + 1;
  stats.partnerCounts[partnerKey] = (stats.partnerCounts[partnerKey] || 0) + 1;
  writeJson(statsFile(tenantId), stats);
  return { userTotal: stats.userCounts[userKey], partnerTotal: stats.partnerCounts[partnerKey] };
}

export function recordDetailedCheckin(username: string, entryKey: string, displayName: string, kind: string, tenantId?: string): { userTotal: number; entryTotal: number } {
  const stats = readJson<CheckinStats>(statsFile(tenantId), { userCounts: {}, partnerCounts: {}, sourceCounts: {}, displayCounts: {} });
  const userKey = username.toLowerCase();
  const displayKey = displayName.toLowerCase();
  const sourceKey = entryKey.toLowerCase();

  stats.userCounts[userKey] = (stats.userCounts[userKey] || 0) + 1;
  stats.sourceCounts = stats.sourceCounts || {};
  stats.displayCounts = stats.displayCounts || {};
  stats.sourceCounts[sourceKey] = (stats.sourceCounts[sourceKey] || 0) + 1;
  stats.displayCounts[displayKey] = (stats.displayCounts[displayKey] || 0) + 1;

  if (kind === 'partner') {
    stats.partnerCounts[displayKey] = (stats.partnerCounts[displayKey] || 0) + 1;
  }

  writeJson(statsFile(tenantId), stats);
  return { userTotal: stats.userCounts[userKey], entryTotal: stats.sourceCounts[sourceKey] };
}

export function getCheckinStats(tenantId?: string): CheckinStats {
  return readJson<CheckinStats>(statsFile(tenantId), { userCounts: {}, partnerCounts: {} });
}

export function getPartnerOverrides(tenantId?: string): PartnerOverrides {
  return readJson<PartnerOverrides>(overridesFile(tenantId), {});
}

export function setPartnerOverrides(overrides: PartnerOverrides, tenantId?: string): void {
  writeJson(overridesFile(tenantId), overrides);
}

export function getPartnerInviteLink(discordUserId: string, tenantId?: string): string | undefined {
  const overrides = getPartnerOverrides(tenantId);
  return overrides[discordUserId]?.inviteLink;
}

export function getEntryInviteLink(entryKey: string, tenantId?: string): string | undefined {
  const overrides = getPartnerOverrides(tenantId);
  return overrides[entryKey]?.inviteLink;
}
