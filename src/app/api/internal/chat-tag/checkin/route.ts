import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { apiError, apiOk } from '@/lib/api-response';
import { hasInternalServiceAccess } from '@/lib/internal-service-auth';
import { tenantPath } from '@/lib/tenant';
import { getTenantIdFromChannel } from '@/services/twitch-client';
import { spaceMountainSourceFromChatters } from '@/services/checkin-sources';
import { getConfigSection } from '@/lib/local-config/service';
import { runBulkCheckin } from '@/services/checkin-flow';

export const dynamic = 'force-dynamic';
const login = z.string().regex(/^[a-z0-9_]{1,25}$/);
const inputSchema = z.object({
  channel: login,
  username: login,
  requestId: z.string().min(1).max(160),
  chatters: z.array(z.object({
    login, name: z.string().min(1).max(80), userId: z.string().max(80),
  })).max(1000),
});

export async function POST(req: NextRequest) {
  if (!hasInternalServiceAccess(req)) return apiError('Unauthorized', { status: 401 });
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid check-in request', { status: 400 });
  const { channel, username, requestId, chatters } = parsed.data;
  const tenantId = getTenantIdFromChannel(channel) || channel;
  // Atomic disk claim works across the Next server and retries after restarts.
  const key = createHash('sha256').update(channel + ':' + requestId).digest('hex');
  const receipt = tenantPath(tenantId, 'data/chat-tag-checkins/' + key + '.json');
  await fs.mkdir(path.dirname(receipt), { recursive: true });
  try {
    const handle = await fs.open(receipt, 'wx');
    await handle.writeFile(JSON.stringify({ pending: true }));
    await handle.close();
  } catch (error: any) {
    if (error.code !== 'EEXIST') throw error;
    let saved: any = { pending: true };
    try { saved = JSON.parse(await fs.readFile(receipt, 'utf8')); } catch {}
    return apiOk(saved.pending
      ? { reply: '@' + username + ', that check-in is already processing.', duplicate: true }
      : { ...saved, duplicate: true });
  }
  let result;
  try {
    const source = await spaceMountainSourceFromChatters(chatters, tenantId);
    const config = await getConfigSection('redeems', tenantId);
    const pointCost = Math.max(0, Number(config.spaceMountainCheckin?.pointCost || 0));
    result = await runBulkCheckin('space-mountain', username, pointCost, tenantId, {
      source,
      // Chat Tag sends the returned result through the bot in the source channel.
      deliver: async () => {},
    });
  } catch (error) {
    console.error('[ChatTag Checkin] Failed for #' + channel, error);
    result = { reply: '@' + username + ', Space Mountain check-in could not finish. Please try again.' };
  }
  await fs.writeFile(receipt, JSON.stringify(result));
  return apiOk(result);
}
