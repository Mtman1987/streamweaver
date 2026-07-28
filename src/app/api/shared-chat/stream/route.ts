import { NextRequest } from 'next/server';

import { getTenantFromRequest } from '@/lib/tenant-context';
import { readSharedChatReplay } from '@/services/shared-chat-ingestion';
import { readSharedChatOperatorState } from '@/services/shared-chat-operator-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sse(event: string, data: unknown, id?: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const tenantId = session.tenantId;
  const lastEventId = String(request.headers.get('last-event-id') || request.nextUrl.searchParams.get('after') || '').trim();
  let cursor = lastEventId;
  let operatorSignature = '';
  let lastHeartbeatAt = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        closed = true;
        if (timer) clearTimeout(timer);
        try { controller.close(); } catch {}
      };
      request.signal.addEventListener('abort', close, { once: true });

      const poll = async () => {
        if (closed) return;
        try {
          const [replay, operator] = await Promise.all([
            readSharedChatReplay(tenantId, { limit: 500 }),
            readSharedChatOperatorState(tenantId),
          ]);
          const cursorIndex = cursor ? replay.findIndex((event) => event.eventId === cursor) : -1;
          const pending = cursor && cursorIndex >= 0 ? replay.slice(cursorIndex + 1) : replay.slice(-200);
          for (const event of pending) {
            controller.enqueue(sse('chat', event, event.eventId));
            cursor = event.eventId;
          }
          const nextOperatorSignature = JSON.stringify(operator);
          if (nextOperatorSignature !== operatorSignature) {
            controller.enqueue(sse('operator', operator));
            operatorSignature = nextOperatorSignature;
          }
          if (Date.now() - lastHeartbeatAt >= 15_000) {
            controller.enqueue(sse('heartbeat', { at: new Date().toISOString(), cursor: cursor || null }));
            lastHeartbeatAt = Date.now();
          }
        } catch (error) {
          controller.enqueue(sse('degraded', {
            at: new Date().toISOString(),
            reason: error instanceof Error ? error.message : 'Shared chat stream unavailable',
          }));
        }
        if (!closed) timer = setTimeout(poll, 2_000);
      };
      await poll();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
