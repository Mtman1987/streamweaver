import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type BridgeConfig = {
  tenantId: string;
  sessionId?: string;
  channel?: string;
  wsUrl?: string;
  targetUrl?: string;
  visibility?: 'public' | 'private';
  enabled?: boolean;
};

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const bridgeScript = path.resolve(process.cwd(), 'scripts', 'social-stream-bridge.ts');
const configPath = path.resolve(
  String(process.env.SOCIAL_STREAM_CONFIG_PATH
    || path.join(process.env.PERSIST_ROOT || process.cwd(), 'config', 'social-stream-bridges.json')),
);
const children = new Map<string, { signature: string; child: ChildProcess }>();
let stopping = false;

export function normalizeSocialStreamBridgeConfig(input: unknown): BridgeConfig[] {
  if (!Array.isArray(input)) return [];
  const tenantIds = new Set<string>();
  return input.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const tenantId = String(row.tenantId || '').trim();
    const sessionId = String(row.sessionId || '').trim();
    const wsUrl = String(row.wsUrl || '').trim();
    if (!tenantId || row.enabled === false || (!sessionId && !wsUrl) || tenantIds.has(tenantId)) return [];
    if (wsUrl && !/^wss:\/\//i.test(wsUrl)) return [];
    const targetUrl = String(row.targetUrl || '').trim();
    if (targetUrl && !/^https?:\/\//i.test(targetUrl)) return [];
    tenantIds.add(tenantId);
    return [{
      tenantId,
      sessionId: sessionId || undefined,
      channel: String(row.channel || '4').trim() || '4',
      wsUrl: wsUrl || undefined,
      targetUrl: targetUrl || undefined,
      visibility: row.visibility === 'private' ? 'private' as const : 'public' as const,
      enabled: true,
    }];
  });
}

function signature(config: BridgeConfig): string {
  return JSON.stringify(config);
}

function stopTenant(tenantId: string) {
  const running = children.get(tenantId);
  if (!running) return;
  children.delete(tenantId);
  running.child.kill();
}

function startTenant(config: BridgeConfig) {
  const configSignature = signature(config);
  const child = spawn(process.execPath, [tsxCli, bridgeScript], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      SOCIAL_STREAM_TENANT_ID: config.tenantId,
      SOCIAL_STREAM_SESSION_ID: config.sessionId || '',
      SOCIAL_STREAM_CHANNEL: config.channel || '4',
      SOCIAL_STREAM_WS_URL: config.wsUrl || '',
      SOCIAL_STREAM_TARGET_URL: config.targetUrl || process.env.SOCIAL_STREAM_TARGET_URL || 'http://127.0.0.1:3100/api/integrations/social-stream',
      SOCIAL_STREAM_VISIBILITY: config.visibility || 'public',
    },
  });
  children.set(config.tenantId, { signature: configSignature, child });
  child.on('exit', (code) => {
    const current = children.get(config.tenantId);
    if (current?.child !== child) return;
    children.delete(config.tenantId);
    if (!stopping) {
      console.warn(`[Social Stream Supervisor] Tenant ${config.tenantId} exited (${code}); configuration reload will restart it.`);
    }
  });
  console.log(`[Social Stream Supervisor] Started tenant ${config.tenantId}.`);
}

async function reconcile() {
  let configs: BridgeConfig[] = [];
  try {
    configs = normalizeSocialStreamBridgeConfig(JSON.parse(await readFile(configPath, 'utf-8')));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') console.warn('[Social Stream Supervisor] Invalid config:', error);
  }
  const desired = new Map(configs.map((config) => [config.tenantId, config]));
  for (const tenantId of children.keys()) {
    if (!desired.has(tenantId)) stopTenant(tenantId);
  }
  for (const config of configs) {
    const running = children.get(config.tenantId);
    if (!running || running.signature !== signature(config)) {
      if (running) stopTenant(config.tenantId);
      startTenant(config);
    }
  }
}

async function main() {
  console.log(`[Social Stream Supervisor] Watching ${configPath}`);
  await reconcile();
  const timer = setInterval(() => void reconcile(), 10_000);
  const shutdown = () => {
    stopping = true;
    clearInterval(timer);
    for (const tenantId of Array.from(children.keys())) stopTenant(tenantId);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}
