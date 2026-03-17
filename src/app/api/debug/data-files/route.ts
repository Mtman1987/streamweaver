import { NextRequest, NextResponse } from 'next/server';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { ACTIONS_FILE_PATH } from '@/lib/actions-store';
import { COMMANDS_FILE_PATH } from '@/lib/commands-store';
import { getPrivateChatFilePath } from '@/lib/private-chat-store';
import { getPublicChatFilePath } from '@/lib/public-chat-store';
import { isDebugRoutesEnabled } from '@/lib/local-config/service';
import { apiError, apiOk } from '@/lib/api-response';

type FileKey = 'actions' | 'commands' | 'private-chat' | 'public-chat' | 'points' | 'point-settings' | 'channel-point-rewards';

function resolveFilePath(file: FileKey): string {
  if (file === 'actions') return ACTIONS_FILE_PATH;
  if (file === 'commands') return COMMANDS_FILE_PATH;
  if (file === 'private-chat') return getPrivateChatFilePath();
  if (file === 'public-chat') return getPublicChatFilePath();
  if (file === 'points') return getUserDataPath('points.json');
  if (file === 'point-settings') return getUserDataPath('point-settings.json');
  if (file === 'channel-point-rewards') return getUserDataPath('channel-point-rewards.json');
  throw new Error(`Unknown file: ${file}`);
}

function getUserDataPath(fileName: string): string {
  const { readUserConfigSync } = require('@/lib/user-config');
  const config = readUserConfigSync();
  const username = config.TWITCH_BROADCASTER_USERNAME || 'default';
  return require('path').resolve(process.cwd(), 'data', username, fileName);
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isDebugRoutesEnabled())) {
      return apiError('Debug routes are disabled', { status: 403, code: 'DEBUG_DISABLED' });
    }

    const url = new URL(request.url);
    const file = (url.searchParams.get('file') || '').toLowerCase() as FileKey;

    if (!['actions', 'commands', 'private-chat', 'public-chat', 'points', 'point-settings', 'channel-point-rewards'].includes(file)) {
      return apiError('Invalid file. Use ?file=actions, ?file=commands, ?file=private-chat, ?file=public-chat, ?file=points, ?file=point-settings, or ?file=channel-point-rewards', { status: 400, code: 'INVALID_QUERY' });
    }

    const filePath = resolveFilePath(file);
    const [stat, raw] = await Promise.all([
      fsp.stat(filePath),
      fsp.readFile(filePath, 'utf-8'),
    ]);

    // Best-effort count (don’t fail the endpoint if JSON is temporarily invalid while editing)
    let count: number | null = null;
    try {
      const parsed = JSON.parse(raw);
      count = Array.isArray(parsed) ? parsed.length : null;
    } catch {
      count = null;
    }

    return apiOk({
      file,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      count,
      // Keep output lightweight and avoid exposing full file content in API responses.
      preview: raw.slice(0, 8000),
    });
  } catch (error) {
    console.error('[debug/data-files] Error:', error);
    return apiError(error instanceof Error ? error.message : 'Failed to read file', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
