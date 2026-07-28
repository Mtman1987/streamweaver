import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function readLocalAppConfig(): { host: string; port: number; openBrowserOnStart: boolean } {
  const filePath = resolve(process.cwd(), 'config', 'app.json');
  if (!existsSync(filePath)) {
    return { host: '127.0.0.1', port: 3100, openBrowserOnStart: true };
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    return {
      host: raw?.server?.host || '127.0.0.1',
      port: Number(raw?.server?.port || 3100),
      openBrowserOnStart: raw?.server?.openBrowserOnStart !== false,
    };
  } catch {
    return { host: '127.0.0.1', port: 3100, openBrowserOnStart: true };
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
    return;
  }
  if (platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true });
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
}

function start(): void {
  const appConfig = readLocalAppConfig();
  const appUrl = process.env.APP_URL || `http://${appConfig.host}:${appConfig.port}`;
  const child = spawn('npx', ['tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WS_PORT: process.env.WS_PORT || '8090',
      PORT: process.env.PORT || String(appConfig.port),
      NEXT_PUBLIC_STREAMWEAVE_PORT: process.env.NEXT_PUBLIC_STREAMWEAVE_PORT || String(appConfig.port),
    },
    shell: true,
    stdio: 'inherit',
  });
  const socialStreamConfigPath = resolve(
    process.env.SOCIAL_STREAM_CONFIG_PATH
      || process.env.PERSIST_ROOT
      || process.cwd(),
    process.env.SOCIAL_STREAM_CONFIG_PATH ? '' : 'config/social-stream-bridges.json',
  );
  const socialStreamSupervisor = existsSync(socialStreamConfigPath)
    ? spawn('npx', ['tsx', 'scripts/social-stream-supervisor.ts'], {
        cwd: process.cwd(),
        env: { ...process.env, SOCIAL_STREAM_CONFIG_PATH: socialStreamConfigPath },
        shell: true,
        stdio: 'inherit',
      })
    : null;

  const shouldOpenBrowser = process.env.OPEN_BROWSER !== 'false' && appConfig.openBrowserOnStart;
  if (shouldOpenBrowser) {
    setTimeout(() => openBrowser(appUrl), 3500);
  }

  child.on('exit', (code) => {
    socialStreamSupervisor?.kill();
    process.exit(code ?? 0);
  });
}

start();
