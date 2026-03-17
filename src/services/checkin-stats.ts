import fs from 'fs';
import path from 'path';

const STATS_FILE = path.join(process.cwd(), 'data', 'checkin-stats.json');
const OVERRIDES_FILE = path.join(process.cwd(), 'data', 'partner-overrides.json');

interface CheckinStats {
  userCounts: Record<string, number>;       // username -> total check-ins
  partnerCounts: Record<string, number>;    // partnerName -> total community check-ins
}

// { discordUserId: { inviteLink: "https://discord.gg/xxx" } }
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

export function recordCheckin(username: string, partnerName: string): { userTotal: number; partnerTotal: number } {
  const stats = readJson<CheckinStats>(STATS_FILE, { userCounts: {}, partnerCounts: {} });
  const userKey = username.toLowerCase();
  const partnerKey = partnerName.toLowerCase();

  stats.userCounts[userKey] = (stats.userCounts[userKey] || 0) + 1;
  stats.partnerCounts[partnerKey] = (stats.partnerCounts[partnerKey] || 0) + 1;

  writeJson(STATS_FILE, stats);
  return { userTotal: stats.userCounts[userKey], partnerTotal: stats.partnerCounts[partnerKey] };
}

export function getCheckinStats(): CheckinStats {
  return readJson<CheckinStats>(STATS_FILE, { userCounts: {}, partnerCounts: {} });
}

export function getPartnerOverrides(): PartnerOverrides {
  return readJson<PartnerOverrides>(OVERRIDES_FILE, {});
}

export function setPartnerOverrides(overrides: PartnerOverrides): void {
  writeJson(OVERRIDES_FILE, overrides);
}

export function getPartnerInviteLink(discordUserId: string): string | undefined {
  const overrides = getPartnerOverrides();
  return overrides[discordUserId]?.inviteLink;
}
