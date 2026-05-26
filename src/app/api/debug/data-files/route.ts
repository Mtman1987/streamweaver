import { NextRequest, NextResponse } from 'next/server';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { ACTIONS_FILE_PATH } from '@/lib/actions-store';
import { COMMANDS_FILE_PATH } from '@/lib/commands-store';
import { getPrivateChatFilePath } from '@/lib/private-chat-store';
import { getPublicChatFilePath } from '@/lib/public-chat-store';
import { isDebugRoutesEnabled } from '@/lib/local-config/service';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiError, apiOk } from '@/lib/api-response';
import { isAdmin, listTenants, tenantPath } from '@/lib/tenant';
import { globalPath } from '@/lib/tenant';

type FileKey = 'actions' | 'commands' | 'private-chat' | 'public-chat' | 'points' | 'point-settings' | 'channel-point-rewards' | 'shoutout-audit' | 'fly-logs' | 'gen-mode' | 'gen-settings' | 'dm-sweep-state' | 'generated-images-index';

function filterAuditRecords(records: unknown[], username?: string): unknown[] {
  const normalizedUser = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!normalizedUser) return records;
  return records.filter((record: any) => String(record?.username || '').toLowerCase() === normalizedUser);
}

function resolveFilePath(file: FileKey, tenantId?: string): string {
  if (file === 'actions') return ACTIONS_FILE_PATH;
  if (file === 'commands') return COMMANDS_FILE_PATH;
  if (file === 'private-chat') return getPrivateChatFilePath(tenantId);
  if (file === 'public-chat') return getPublicChatFilePath();
  if (file === 'points') return getUserDataPath('points.json', tenantId);
  if (file === 'point-settings') return getUserDataPath('point-settings.json', tenantId);
  if (file === 'channel-point-rewards') return getUserDataPath('channel-point-rewards.json', tenantId);
  if (file === 'fly-logs') return globalPath('fly-logs.txt');

  if (file === 'gen-mode') return tenantId ? tenantPath(tenantId, 'data/gen-mode.json') : globalPath('data/gen-mode.json');
  if (file === 'gen-settings') return tenantId ? tenantPath(tenantId, 'data/gen-settings.json') : globalPath('data/gen-settings.json');
  if (file === 'dm-sweep-state') return tenantId ? tenantPath(tenantId, 'data/discord-dm-sweep-state.json') : globalPath('data/discord-dm-sweep-state.json');
  if (file === 'generated-images-index') return tenantId ? tenantPath(tenantId, 'data/generated-images/index.json') : globalPath('data/generated-images/index.json');
  if (file === 'shoutout-audit') return tenantId
    ? tenantPath(tenantId, 'logs/shoutout-audit.json')
    : path.resolve(process.cwd(), 'logs', 'shoutout-audit.json');
  throw new Error(`Unknown file: ${file}`);
}

function getUserDataPath(fileName: string, tenantId?: string): string {
  if (tenantId) {
    const { tenantPath } = require('@/lib/tenant');
    const { readUserConfigSync } = require('@/lib/user-config');
    const config = readUserConfigSync(tenantId);
    const username = config.TWITCH_BROADCASTER_USERNAME || 'default';
    return path.join(tenantPath(tenantId, 'data'), username, fileName);
  }
  const { readUserConfigSync } = require('@/lib/user-config');
  const config = readUserConfigSync();
  const username = config.TWITCH_BROADCASTER_USERNAME || 'default';
  return path.resolve(process.cwd(), 'data', username, fileName);
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isDebugRoutesEnabled())) {
      return apiError('Debug routes are disabled', { status: 403, code: 'DEBUG_DISABLED' });
    }

    const url = new URL(request.url);
    const file = (url.searchParams.get('file') || '').toLowerCase() as FileKey;

    if (!['actions', 'commands', 'private-chat', 'public-chat', 'points', 'point-settings', 'channel-point-rewards', 'shoutout-audit', 'fly-logs', 'gen-mode', 'gen-settings', 'dm-sweep-state', 'generated-images-index'].includes(file)) {
      return apiError('Invalid file. Use ?file=actions, ?file=commands, ?file=private-chat, ?file=public-chat, ?file=points, ?file=point-settings, ?file=channel-point-rewards, ?file=shoutout-audit, ?file=fly-logs, ?file=gen-mode, ?file=gen-settings, ?file=dm-sweep-state, or ?file=generated-images-index', { status: 400, code: 'INVALID_QUERY' });
    }

    const session = getTenantFromRequest(request);
    const requestedTenantId = url.searchParams.get('tenantId')?.trim() || '';
    const usernameFilter = url.searchParams.get('username')?.trim().replace(/^@/, '') || '';
    const auditFile = file === 'shoutout-audit';
    const admin = isAdmin(session?.tenantId || '');
    if (!auditFile && requestedTenantId && requestedTenantId !== session?.tenantId && !admin) {
      return apiError('Admin only', { status: 403, code: 'FORBIDDEN' });
    }
    const readAllShoutoutAudit = auditFile && (!requestedTenantId || requestedTenantId === 'all');
    if (readAllShoutoutAudit) {
      const tenantIds = await listTenants();
      const files = tenantIds.map((tenantId) => tenantPath(tenantId, 'logs/shoutout-audit.json'));
      const snapshots = await Promise.all(files.map(async (filePath) => {
        try {
          const [stat, raw] = await Promise.all([
            fsp.stat(filePath),
            fsp.readFile(filePath, 'utf-8'),
          ]);
          const parsed = JSON.parse(raw);
          return {
            stat,
            records: Array.isArray(parsed) ? parsed : [],
          };
        } catch {
          return { stat: null, records: [] as unknown[] };
        }
      }));
      const records = filterAuditRecords(snapshots.flatMap((snapshot) => snapshot.records), usernameFilter);
      records.sort((a: any, b: any) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
      const latestMtime = Math.max(0, ...snapshots.map((snapshot) => snapshot.stat?.mtimeMs || 0));
      const preview = `${JSON.stringify(records, null, 2)}\n`;
      return apiOk({
        file,
        path: '/data/runtime/tenants/*/logs/shoutout-audit.json',
        mtimeMs: latestMtime,
        size: Buffer.byteLength(preview, 'utf-8'),
        count: records.length,
        preview: preview.slice(0, 8000),
      });
    }

    const tenantId = requestedTenantId || session?.tenantId;
    const filePath = resolveFilePath(file, tenantId);

    // Handle missing files gracefully
    try {
      await fsp.access(filePath);
    } catch {
      return apiOk({
        file,
        path: filePath,
        mtimeMs: 0,
        size: 0,
        count: 0,
        preview: '[]',
        empty: true,
      });
    }

    const [stat, raw] = await Promise.all([
      fsp.stat(filePath),
      fsp.readFile(filePath, 'utf-8'),
    ]);

    // Best-effort count (don’t fail the endpoint if JSON is temporarily invalid while editing)
    let count: number | null = null;
    let previewRaw = raw;
    try {
      const parsed = JSON.parse(raw);
      if (auditFile && Array.isArray(parsed) && usernameFilter) {
        const filtered = filterAuditRecords(parsed, usernameFilter);
        count = filtered.length;
        previewRaw = `${JSON.stringify(filtered, null, 2)}\n`;
      } else {
        count = Array.isArray(parsed) ? parsed.length : null;
      }
    } catch {
      count = null;
    }

    return apiOk({
      file,
      path: filePath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      count,
      // Keep output lightweight and avoid exposing full file content in API responses.
      preview: previewRaw.slice(0, 8000),
    });
  } catch (error) {
    console.error('[debug/data-files] Error:', error);
    return apiError(error instanceof Error ? error.message : 'Failed to read file', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
