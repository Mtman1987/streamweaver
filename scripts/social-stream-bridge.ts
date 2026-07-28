import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sessionId = String(process.env.SOCIAL_STREAM_SESSION_ID || '').trim();
const channel = String(process.env.SOCIAL_STREAM_CHANNEL || '4').trim();
const targetUrl = String(process.env.SOCIAL_STREAM_TARGET_URL || 'http://127.0.0.1:3100/api/integrations/social-stream').trim();
const bridgeToken = String(process.env.SOCIAL_STREAM_BRIDGE_TOKEN || process.env.BOT_SECRET_KEY || '').trim();
const tenantId = String(process.env.SOCIAL_STREAM_TENANT_ID || '').trim();
const visibility = String(process.env.SOCIAL_STREAM_VISIBILITY || 'public').trim();
const sourceUrl = String(process.env.SOCIAL_STREAM_WS_URL || `wss://io.socialstream.ninja/join/${encodeURIComponent(sessionId)}/${encodeURIComponent(channel)}`);
const stateRoot = String(process.env.PERSIST_ROOT || process.cwd()).trim();
const statePath = path.join(stateRoot, 'data', `social-stream-bridge-${tenantId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default'}.json`);

if (!sessionId && !process.env.SOCIAL_STREAM_WS_URL) {
  console.error('SOCIAL_STREAM_SESSION_ID is required unless SOCIAL_STREAM_WS_URL is set.');
  process.exit(1);
}

let retryMs = 1000;
let reconnectCount = 0;
let seenIds: string[] = [];
let lastForwardedId = '';
let forwardChain = Promise.resolve();

type BridgeState = {
  tenantId: string;
  sessionId: string;
  channel: string;
  connected: boolean;
  reconnectCount: number;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastMessageAt: string | null;
  lastForwardedId: string | null;
  lastPongAt: string | null;
  seenIds: string[];
  updatedAt: string;
};

let bridgeState: BridgeState = {
  tenantId,
  sessionId,
  channel,
  connected: false,
  reconnectCount: 0,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastMessageAt: null,
  lastForwardedId: null,
  lastPongAt: null,
  seenIds: [],
  updatedAt: new Date().toISOString(),
};

async function persistState(patch: Partial<BridgeState> = {}) {
  bridgeState = {
    ...bridgeState,
    ...patch,
    reconnectCount,
    lastForwardedId: lastForwardedId || null,
    seenIds: seenIds.slice(-1000),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(bridgeState, null, 2), 'utf-8');
  await rename(tempPath, statePath);
}

async function restoreState() {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf-8')) as Partial<BridgeState>;
    seenIds = Array.isArray(parsed.seenIds)
      ? parsed.seenIds.filter((id): id is string => typeof id === 'string').slice(-1000)
      : [];
    lastForwardedId = typeof parsed.lastForwardedId === 'string' ? parsed.lastForwardedId : '';
    reconnectCount = Number.isFinite(parsed.reconnectCount) ? Number(parsed.reconnectCount) : 0;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') console.warn('[Social Stream Bridge] Could not restore cursor state:', error);
  }
}

function payloadId(payload: Record<string, unknown>): string {
  const explicit = payload.id || payload.mid || payload.messageId || (payload.meta as Record<string, unknown> | undefined)?.messageId;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function forwardPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return;
  const id = payloadId(payload as Record<string, unknown>);
  if (seenIds.includes(id)) {
    console.log(`[Social Stream Bridge] Skipped replayed message ${id}`);
    return;
  }
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
      ...(tenantId ? { 'x-streamweaver-tenant-id': tenantId } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`StreamWeaver bridge POST failed: ${response.status} ${text}`);
  }
  seenIds.push(id);
  seenIds = seenIds.slice(-1000);
  lastForwardedId = id;
  await persistState({ lastMessageAt: new Date().toISOString() });
}

async function connectOnce(): Promise<void> {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(sourceUrl);
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let lastPongAt = Date.now();

    ws.on('open', () => {
      retryMs = 1000;
      reconnectCount += 1;
      lastPongAt = Date.now();
      void persistState({
        connected: true,
        lastConnectedAt: new Date().toISOString(),
        lastPongAt: new Date(lastPongAt).toISOString(),
      });
      heartbeat = setInterval(() => {
        if (Date.now() - lastPongAt > 45_000) {
          console.warn('[Social Stream Bridge] Heartbeat timed out; reconnecting.');
          ws.terminate();
          return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 20_000);
      console.log(`[Social Stream Bridge] Connected to ${sourceUrl}`);
    });

    ws.on('pong', () => {
      lastPongAt = Date.now();
      void persistState({ lastPongAt: new Date(lastPongAt).toISOString() });
    });

    ws.on('message', (raw) => {
      forwardChain = forwardChain.then(async () => {
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
    });

    ws.on('error', (error) => {
      console.warn('[Social Stream Bridge] WebSocket error:', error.message);
    });

    ws.on('close', () => {
      if (heartbeat) clearInterval(heartbeat);
      void persistState({ connected: false, lastDisconnectedAt: new Date().toISOString() });
      console.warn('[Social Stream Bridge] Disconnected.');
      resolve();
    });
  });
}

async function main() {
  await restoreState();
  await persistState();
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
