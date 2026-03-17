import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { isDebugRoutesEnabled } from '@/lib/local-config/service';
import { apiError, apiOk } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

async function rmSafe(targetPath: string): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Development utility: clears local auth/config persisted on disk.
 *
 * This resets the app to a "new user" state by removing local token/config files.
 * It intentionally does NOT delete actions/commands stored elsewhere.
 */
export async function POST(request: NextRequest) {
  if (!(await isDebugRoutesEnabled())) {
    return apiError('Debug routes are disabled', { status: 403, code: 'DEBUG_DISABLED' });
  }

  const tokensDir = path.resolve(process.cwd(), 'tokens');

  // Wipe the entire tokens directory: Twitch tokens, user-config, vault, discord channel config, etc.
  await rmSafe(tokensDir);

  return apiOk({ ok: true });
}
