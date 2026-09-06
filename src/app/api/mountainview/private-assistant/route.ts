import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { bearerToken, firstString, resolveSpmtUser, internalSessionCookie } from '@/lib/spmt-request-identity';
import { bootstrapTenant } from '@/lib/tenant';
import { getBotName } from '@/lib/bot-settings-store';
import { appendPrivateChatMessages } from '@/lib/private-chat-store';
import { routeBotAction } from '@/services/bot-action-runtime';
import { executeHearMeOutBotAction } from '@/services/hearmeout-actions';
import { generateTTS } from '@/services/tts-provider';
import { POST as respondToPrivateChat } from '@/app/api/private-chat/respond/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Serializes a user's queue controls and coalesces repeated mobile requests.
const pending = new Map<string, Promise<unknown>>();
const replies = new Map<string, { expires: number; value: Promise<any> }>();
async function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = pending.get(key);
  const next = (previous || Promise.resolve()).catch(() => {}).then(work);
  pending.set(key, next);
  try { return await next; } finally { if (pending.get(key) === next) pending.delete(key); }
}

async function speech(text: string, tenantId: string) {
  if (!text) return null;
  try {
    // Use the same tenant voice and provider routing as /api/tts. Do not queue
    // private speech on a room, stream overlay, or other public output.
    const audioDataUris: string[] = [];
    let rest = text;
    while (rest) {
      let end = Math.min(1800, rest.length);
      if (end < rest.length) end = Math.max(rest.lastIndexOf(' ', end), 1000);
      const audio = await generateTTS(rest.slice(0, end), undefined, tenantId);
      if (!audio) throw new Error('Voice service returned no audio');
      audioDataUris.push(audio);
      rest = rest.slice(end).trimStart();
    }
    return { ok: true, audioDataUris };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Voice service unavailable' };
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = bearerToken(request);
    if (!token) return apiError('SPMT sign-in is required', { status: 401 });
    const user = await resolveSpmtUser(token);
    if (!user) return apiError('SPMT session expired', { status: 401 });
    const body = await request.json().catch(() => null);
    const action = firstString(body?.action) || 'utterance';
    if (!['ensure', 'utterance', 'speech', 'state', 'ended'].includes(action)) {
      return apiError('Unsupported private assistant action');
    }
    const text = firstString(body?.text).slice(0, 8000);
    if ((action === 'utterance' || action === 'speech') && !text) return apiError('Text is required');
    const identity = internalSessionCookie(user);
    const tenantId = identity.tenantId;
    await bootstrapTenant(tenantId, identity.username);
    const botName = getBotName(tenantId);
    // Never accept a tenant, room, or session selector from the mobile client.
    const sessionId = 'watch-companion-' + createHash('sha256').update(`${tenantId}:${user.id}`).digest('hex').slice(0, 40);
    const base = { private: true, transport: 'local', persona: botName, sessionId };
    if (action === 'ensure') return apiOk({ ...base, status: 'ready' });
    if (action === 'speech') return apiOk({ ...base, tts: await speech(text, tenantId) });

    const media = (control?: string) => executeHearMeOutBotAction({
      action: control ? 'hmo.media.control' : 'hmo.media.state.read',
      tenantId, sessionId, control, actorUserId: user.id, actorName: identity.username,
    });
    const requestId = firstString(body?.requestId).slice(0, 100);
    const cacheKey = `${sessionId}:${requestId}`;
    for (const [key, entry] of replies) if (entry.expires < Date.now()) replies.delete(key);
    if (requestId && replies.has(cacheKey)) return apiOk(await replies.get(cacheKey)!.value);
    const work = serial(sessionId, async () => {
      if (action === 'state' || action === 'ended') {
        let result: any = await media();
        // A late completion event must never skip a newer track.
        if (action === 'ended' && body?.currentRequestId && result.session?.current?.requestId === body.currentRequestId) {
          result = await media('next');
        }
        return { ...base, media: result.session };
      }
      const outcome = await routeBotAction(text, {
        tenantId, botName, source: 'mountainview', message: text, visibility: 'private',
        playbackSessionId: sessionId, requestId,
        actor: { userId: user.id, username: identity.username, displayName: identity.displayName, role: 'owner' },
      });
      let reply = '';
      let result: any = outcome?.result;
      if (outcome) {
        reply = outcome.response;
        if (outcome.action === 'hmo.media.request' && outcome.status === 'completed') {
          const requestedId = result?.request?.requestId;
          // "Play X" takes over this user's local queue; an explicit "queue X"
          // keeps the current song. The room/global queues are never touched.
          if (!/\b(?:queue|add)\b/i.test(text) && requestedId) {
            const remaining = Math.min(Number(result?.session?.queue?.length || 0), 50);
            for (let i = 0; i < remaining && result?.session?.current?.requestId !== requestedId; i++) {
              result = { ...result, ...(await media('next')) };
            }
            if (result?.session?.current?.requestId === requestedId) reply = `I'm starting ${result.session.current.item.title}.`;
          }
          result = { ...result, ...(await media('unmute')) };
          if (result?.session?.playback?.status !== 'playing') result = { ...result, ...(await media('play')) };
        }
        await appendPrivateChatMessages([
          { type: 'user', username: identity.username, message: text, timestamp: new Date().toISOString() },
          { type: 'ai', username: botName, message: reply, timestamp: new Date().toISOString() },
        ], 100, tenantId);
      } else {
        const response = await respondToPrivateChat(new NextRequest('http://localhost/api/private-chat/respond', {
          method: 'POST', headers: { 'content-type': 'application/json', cookie: identity.header },
          body: JSON.stringify({ username: identity.username, message: text, tenantId }),
        }));
        const data = await response.json();
        if (!response.ok) throw new Error(firstString(data.error, 'Private chat service unavailable'));
        reply = firstString(data.response, data.data?.response);
      }
      return {
        ...base, reply, status: outcome?.status || 'completed',
        media: result?.session, commandType: outcome?.action,
        tts: body?.speak === false ? null : await speech(reply, tenantId),
      };
    });
    if (requestId) {
      if (replies.size >= 500) replies.delete(replies.keys().next().value!);
      replies.set(cacheKey, { expires: Date.now() + 300_000, value: work });
      void work.catch(() => replies.delete(cacheKey));
    }
    return apiOk(await work);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Private assistant unavailable', { status: 503 });
  }
}
