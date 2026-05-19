import * as fs from 'fs/promises';
import { dirname, resolve } from 'path';
import { tenantPath } from '../lib/tenant';

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
  if (tenantId) return tenantPath(tenantId, 'logs/shoutout-audit.jsonl');
  return resolve(process.cwd(), 'logs', 'shoutout-audit.jsonl');
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function trimAuditFile(filePath: string): Promise<void> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= MAX_AUDIT_LINES) return;
    await fs.writeFile(filePath, `${lines.slice(-MAX_AUDIT_LINES).join('\n')}\n`, 'utf-8');
  } catch {}
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
    await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf-8');

    const stats = await fs.stat(filePath);
    if (stats.size > 2 * 1024 * 1024) {
      await trimAuditFile(filePath);
    }
  } catch (error) {
    console.error('[ShoutoutAudit] Failed to write audit event:', stringifyError(error));
  }
}

export async function readRecentShoutoutAudit(tenantId?: string, limit = 200): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(auditPath(tenantId), 'utf-8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(limit, 1000)))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { timestamp: null, status: 'invalid', raw: line };
        }
      })
      .reverse();
  } catch {
    return [];
  }
}

export async function readShoutoutAuditText(tenantId?: string, username?: string): Promise<string> {
  try {
    const raw = await fs.readFile(auditPath(tenantId), 'utf-8');
    const normalizedUser = String(username || '').trim().replace(/^@/, '').toLowerCase();
    if (!normalizedUser) return raw;

    const filtered = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => {
        try {
          const parsed = JSON.parse(line);
          return String(parsed.username || '').toLowerCase() === normalizedUser;
        } catch {
          return false;
        }
      });

    return filtered.length > 0 ? `${filtered.join('\n')}\n` : '';
  } catch {
    return '';
  }
}

export function auditError(error: unknown): string {
  return stringifyError(error);
}
