import WebSocket from 'ws';

const sessionId = String(process.env.SOCIAL_STREAM_SESSION_ID || '').trim();
const channel = String(process.env.SOCIAL_STREAM_CHANNEL || '4').trim();
const targetUrl = String(process.env.SOCIAL_STREAM_TARGET_URL || 'http://127.0.0.1:3100/api/integrations/social-stream').trim();
const bridgeToken = String(process.env.SOCIAL_STREAM_BRIDGE_TOKEN || process.env.BOT_SECRET_KEY || '').trim();
const tenantId = String(process.env.SOCIAL_STREAM_TENANT_ID || '').trim();
const visibility = String(process.env.SOCIAL_STREAM_VISIBILITY || 'public').trim();
const sourceUrl = String(process.env.SOCIAL_STREAM_WS_URL || `wss://io.socialstream.ninja/join/${encodeURIComponent(sessionId)}/${encodeURIComponent(channel)}`);

if (!sessionId && !process.env.SOCIAL_STREAM_WS_URL) {
  console.error('SOCIAL_STREAM_SESSION_ID is required unless SOCIAL_STREAM_WS_URL is set.');
  process.exit(1);
}

let retryMs = 1000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function forwardPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return;
  const body = {
    ...(payload as Record<string, unknown>),
    ...(tenantId ? { tenantId } : {}),
    ...(visibility ? { visibility } : {}),
  };

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bridgeToken ? { authorization: `Bearer ${bridgeToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`StreamWeaver bridge POST failed: ${response.status} ${text}`);
  }
}

async function connectOnce(): Promise<void> {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(sourceUrl);

    ws.on('open', () => {
      retryMs = 1000;
      console.log(`[Social Stream Bridge] Connected to ${sourceUrl}`);
    });

    ws.on('message', async (raw) => {
      try {
        const text = raw.toString();
        const payload = JSON.parse(text);
        await forwardPayload(payload);
        const name = typeof payload?.chatname === 'string' ? payload.chatname : 'unknown';
        const type = typeof payload?.type === 'string' ? payload.type : 'social-stream';
        console.log(`[Social Stream Bridge] Forwarded ${type} message from ${name}`);
      } catch (error) {
        console.warn('[Social Stream Bridge] Failed to forward message:', error);
      }
    });

    ws.on('error', (error) => {
      console.warn('[Social Stream Bridge] WebSocket error:', error.message);
    });

    ws.on('close', () => {
      console.warn('[Social Stream Bridge] Disconnected.');
      resolve();
    });
  });
}

async function main() {
  while (true) {
    await connectOnce();
    console.log(`[Social Stream Bridge] Reconnecting in ${retryMs}ms.`);
    await delay(retryMs);
    retryMs = Math.min(retryMs * 2, 30000);
  }
}

main().catch((error) => {
  console.error('[Social Stream Bridge] Fatal error:', error);
  process.exit(1);
});
