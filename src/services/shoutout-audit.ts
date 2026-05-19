import * as fs from 'fs/promises';
import { dirname, resolve } from 'path';
import { listTenants, tenantPath } from '../lib/tenant';

export type ShoutoutAuditStatus =
  | 'triggered'
  | 'started'
  | 'phase'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface ShoutoutAuditEvent {
  status: ShoutoutAuditStatus;
  username: string;
  displayName?: string;
  tenantId?: string;
  source?: 'auto-welcome' | 'manual' | 'voice' | 'recovery' | 'unknown';
  mode?: string;
  reason?: string;
  phase?: string;
  message?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

const MAX_AUDIT_LINES = Number(process.env.SHOUTOUT_AUDIT_MAX_LINES || 5000);

function auditPath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'logs/shoutout-audit.json');
  return resolve(process.cwd(), 'logs', 'shoutout-audit.json');
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function parseAuditRecords(raw: string): Record<string, unknown>[] {
  if (!raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

async function readAuditRecords(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return parseAuditRecords(raw);
  } catch {
    return [];
  }
}

async function writeAuditRecords(filePath: string, records: Record<string, unknown>[]): Promise<void> {
  const trimmed = records.slice(-MAX_AUDIT_LINES);
  await fs.writeFile(filePath, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf-8');
}

export async function recordShoutoutAudit(event: ShoutoutAuditEvent): Promise<void> {
  const filePath = auditPath(event.tenantId);
  const username = String(event.username || '').trim().toLowerCase();
  const record = {
    timestamp: new Date().toISOString(),
    ...event,
    username,
    tenantId: event.tenantId || 'global',
  };

  try {
    await fs.mkdir(dirname(filePath), { recursive: true });
    const records = await readAuditRecords(filePath);
    records.push(record);
    await writeAuditRecords(filePath, records);
  } catch (error) {
    console.error('[ShoutoutAudit] Failed to write audit event:', stringifyError(error));
  }
}

export async function readRecentShoutoutAudit(tenantId?: string, limit = 200): Promise<Record<string, unknown>[]> {
  try {
    const records = await readAuditRecords(auditPath(tenantId));
    return records
      .slice(-Math.max(1, Math.min(limit, 1000)))
      .reverse();
  } catch {
    return [];
  }
}

export async function readRecentShoutoutAuditForAllTenants(limit = 200): Promise<Record<string, unknown>[]> {
  const tenantIds = await listTenants();
  const records = (
    await Promise.all(
      tenantIds.map((tenantId) => readAuditRecords(auditPath(tenantId)))
    )
  ).flat();

  return records
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, Math.max(1, Math.min(limit, 1000)));
}

export async function readShoutoutAuditText(tenantId?: string, username?: string): Promise<string> {
  try {
    const records = await readAuditRecords(auditPath(tenantId));
    const normalizedUser = String(username || '').trim().replace(/^@/, '').toLowerCase();
    if (!normalizedUser) return `${JSON.stringify(records, null, 2)}\n`;

    const filtered = records.filter((record) => (
      String(record.username || '').toLowerCase() === normalizedUser
    ));

    return `${JSON.stringify(filtered, null, 2)}\n`;
  } catch {
    return '[]\n';
  }
}

export async function readAllTenantShoutoutAuditText(username?: string): Promise<string> {
  try {
    const tenantIds = await listTenants();
    const records = (
      await Promise.all(
        tenantIds.map((tenantId) => readAuditRecords(auditPath(tenantId)))
      )
    ).flat();
    const normalizedUser = String(username || '').trim().replace(/^@/, '').toLowerCase();
    const filtered = normalizedUser
      ? records.filter((record) => String(record.username || '').toLowerCase() === normalizedUser)
      : records;
    filtered.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    return `${JSON.stringify(filtered, null, 2)}\n`;
  } catch {
    return '[]\n';
  }
}

export function auditError(error: unknown): string {
  return stringifyError(error);
}
