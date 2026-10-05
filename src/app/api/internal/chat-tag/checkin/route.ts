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
import { sendStellaCheckinShoutout, sendStellaCheckinChatShoutout, formatCheckinShoutoutReply, formatCheckinChatShoutoutReply } from '@/services/checkin-shoutout';

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
  // Only the winner of the durable message claim may send the native shoutout.
  // This runs independently of check-in eligibility, points, or AI delivery.
  const shoutoutPromise = sendStellaCheckinShoutout(channel).catch(() => ({
    status: 'unavailable', channel, destination: 'spacemountainlive', sender: 'stellabot87',
  }));
  // Run after the native attempt settles so credential refreshes are not
  // duplicated. Every outcome still gets the ordinary !so chat command.
  const chatShoutoutPromise = shoutoutPromise.then(() => sendStellaCheckinChatShoutout(channel)).catch(() => ({
    status: 'unavailable', channel, destination: 'spacemountainlive', sender: 'stellabot87', messageId: undefined,
  }));
  let result;
  try {
    const source = await spaceMountainSourceFromChatters(chatters, tenantId);
    const config = await getConfigSection('redeems', tenantId);
    const pointCost = Math.max(0, Number(config.spaceMountainCheckin?.pointCost || 0));
    result = await runBulkCheckin('space-mountain', username, pointCost, tenantId, {
      source,
      awardId: key,
      channel,
      // Chat Tag sends the returned result through the bot in the source channel.
      deliver: async () => {},
    });
  } catch (error) {
    console.error('[ChatTag Checkin] Failed for #' + channel, error);
    result = { reply: '@' + username + ', Space Mountain check-in could not finish. Please try again.' };
  }
  const [shoutout, chatShoutout] = await Promise.all([shoutoutPromise, chatShoutoutPromise]);
  console.info('[CheckinShoutout]', JSON.stringify({ channel, destination: shoutout.destination, sender: shoutout.sender, status: shoutout.status, chatStatus: chatShoutout.status, chatMessageId: chatShoutout.messageId }));
  const notice = formatCheckinShoutoutReply(shoutout);
  const chatNotice = formatCheckinChatShoutoutReply(chatShoutout);
  result = { ...result, shoutout, chatShoutout, reply: [result.reply, notice, chatNotice].filter(Boolean).join(' ') };
  await fs.writeFile(receipt, JSON.stringify(result));
  return apiOk(result);
}
