import { spawnSync } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const runtimeDir = path.join(rootDir, 'dist', 'companion-runtime');

async function ensureDir(target: string): Promise<void> {
  await fsp.mkdir(target, { recursive: true });
}

async function copyFile(source: string, destination: string): Promise<void> {
  await ensureDir(path.dirname(destination));
  await fsp.copyFile(source, destination);
}

async function copyTree(
  source: string,
  destination: string,
  include: (relativePath: string) => boolean = () => true,
  relativePath = '',
): Promise<void> {
  const entries = await fsp.readdir(source, { withFileTypes: true });
  await ensureDir(destination);
  for (const entry of entries) {
    const childRelativePath = path.join(relativePath, entry.name);
    if (!include(childRelativePath)) continue;
    const childSource = path.join(source, entry.name);
    const childDestination = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyTree(childSource, childDestination, include, childRelativePath);
    } else {
      await copyFile(childSource, childDestination);
    }
  }
}

async function writeJson(target: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(target));
  await fsp.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(await fsp.readFile(path.join(rootDir, 'package.json'), 'utf8'));

  await fsp.rm(runtimeDir, { recursive: true, force: true });
  await ensureDir(runtimeDir);

  await copyFile(process.execPath, path.join(runtimeDir, process.platform === 'win32' ? 'node.exe' : 'bin/node'));
  await copyFile(path.join(rootDir, 'server.ts'), path.join(runtimeDir, 'server.ts'));
  await copyFile(path.join(rootDir, 'tsconfig.json'), path.join(runtimeDir, 'tsconfig.json'));
  await copyFile(path.join(rootDir, 'next.config.js'), path.join(runtimeDir, 'next.config.js'));
  await copyFile(path.join(rootDir, 'app-urls.json'), path.join(runtimeDir, 'app-urls.json'));
  await copyFile(path.join(rootDir, 'package-lock.json'), path.join(runtimeDir, 'package-lock.json'));
  await copyTree(path.join(rootDir, 'src'), path.join(runtimeDir, 'src'));
  await copyTree(
    path.join(rootDir, '.next-release'),
    path.join(runtimeDir, '.next'),
    (relativePath) => !/^(cache|diagnostics|types)([\\/]|$)/i.test(relativePath) && !/^trace$/i.test(relativePath),
  );
  await copyTree(
    path.join(rootDir, 'public'),
    path.join(runtimeDir, 'public'),
    (relativePath) => !/^avatars[\\/](New folder|New folder\.zip)([\\/]|$)/i.test(relativePath),
  );

  await writeJson(path.join(runtimeDir, 'package.json'), {
    ...packageJson,
    name: '@spmt/companion-runtime',
    private: true,
    scripts: {},
  });

  await writeJson(path.join(runtimeDir, 'config', 'app.json'), {
    server: { host: '127.0.0.1', port: 3100, wsPort: 8090, openBrowserOnStart: false },
    security: { requireApiKey: true, apiKey: '', allowDebugRoutes: false },
    logging: { level: 'info', redactSensitiveLogs: true },
  });
  for (const name of ['twitch', 'discord', 'game', 'economy', 'automation']) {
    await writeJson(path.join(runtimeDir, 'config', `${name}.json`), {});
  }
  for (const name of ['data', 'logs', 'tokens']) {
    await ensureDir(path.join(runtimeDir, name));
    await fsp.writeFile(path.join(runtimeDir, name, '.gitkeep'), '', 'utf8');
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const install = spawnSync(npmCommand, ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: runtimeDir,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (install.status !== 0) {
    throw new Error(`Runtime dependency install failed with exit code ${install.status}`);
  }

  const files = await fsp.readdir(runtimeDir);
  if (!files.includes(process.platform === 'win32' ? 'node.exe' : 'bin')) {
    throw new Error('Runtime Node executable was not staged');
  }
  if (!files.includes('tsconfig.json')) {
    throw new Error('Runtime TypeScript path-alias configuration was not staged');
  }
  console.log(`[stage-companion-runtime] staged ${runtimeDir}`);
}

void main();
