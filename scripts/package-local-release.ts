import { promises as fsp } from 'fs';
import path from 'path';

const rootDir = process.cwd();
const target = (process.argv[2] || 'source').toLowerCase();
const distDir = path.join(rootDir, 'dist');
const releaseDir = path.join(distDir, `StreamWeaver-${target}`);
const binaryDir = path.join(distDir, 'bin');

type PlatformTarget = 'win' | 'mac' | 'linux' | 'source';

const readme = `# StreamWeaver Local App

## Run

1. Keep the \`config\`, \`data\`, and \`logs\` folders next to the app.
2. Start the app using one of these options:
   - Windows packaged build: run \`StreamWeaver.exe\`
   - macOS/Linux packaged build: run \`./StreamWeaver\`
   - Source distribution: run \`npm start\`
3. Open http://127.0.0.1:3100 if your browser does not open automatically.

## Local-only model

- HTTP and WebSocket services bind to \`127.0.0.1\` only.
- Settings live in \`config/*.json\`.
- Use the API key in \`config/app.json\` to unlock the browser settings UI.
`;

async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function copyIfExists(fromPath: string, toPath: string): Promise<void> {
  try {
    const stats = await fsp.stat(fromPath);
    if (stats.isDirectory()) {
      await ensureDir(toPath);
      const entries = await fsp.readdir(fromPath, { withFileTypes: true });
      for (const entry of entries) {
        await copyIfExists(path.join(fromPath, entry.name), path.join(toPath, entry.name));
      }
      return;
    }

    await ensureDir(path.dirname(toPath));
    await fsp.copyFile(fromPath, toPath);
  } catch {
    // Skip missing optional paths.
  }
}

async function writeJsonIfMissing(filePath: string, value: unknown): Promise<void> {
  try {
    await fsp.access(filePath);
  } catch {
    await ensureDir(path.dirname(filePath));
    await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  }
}

function binaryNameForTarget(platform: PlatformTarget): string | null {
  if (platform === 'win') return 'StreamWeaver.exe';
  if (platform === 'mac' || platform === 'linux') return 'StreamWeaver';
  return null;
}

async function stageRelease(platform: PlatformTarget): Promise<void> {
  await fsp.rm(releaseDir, { recursive: true, force: true });
  await ensureDir(releaseDir);
  await ensureDir(path.join(releaseDir, 'config'));
  await ensureDir(path.join(releaseDir, 'data'));
  await ensureDir(path.join(releaseDir, 'logs'));

  await copyIfExists(path.join(rootDir, 'config'), path.join(releaseDir, 'config'));
  await copyIfExists(path.join(rootDir, 'data'), path.join(releaseDir, 'data'));

  await writeJsonIfMissing(path.join(releaseDir, 'config', 'app.json'), {
    server: { host: '127.0.0.1', port: 3100, wsPort: 8090, openBrowserOnStart: true },
    security: { requireApiKey: true, apiKey: '', allowDebugRoutes: false },
    logging: { level: 'info', redactSensitiveLogs: true },
  });
  await writeJsonIfMissing(path.join(releaseDir, 'config', 'twitch.json'), {});
  await writeJsonIfMissing(path.join(releaseDir, 'config', 'discord.json'), {});
  await writeJsonIfMissing(path.join(releaseDir, 'config', 'game.json'), {});
  await writeJsonIfMissing(path.join(releaseDir, 'config', 'economy.json'), {});
  await writeJsonIfMissing(path.join(releaseDir, 'config', 'automation.json'), {});

  await fsp.writeFile(path.join(releaseDir, 'README.md'), readme, 'utf-8');

  const binaryName = binaryNameForTarget(platform);
  if (binaryName) {
    await copyIfExists(path.join(binaryDir, binaryName), path.join(releaseDir, binaryName));
  } else {
    await copyIfExists(path.join(rootDir, 'package.json'), path.join(releaseDir, 'package.json'));
    await copyIfExists(path.join(rootDir, 'server.ts'), path.join(releaseDir, 'server.ts'));
    await copyIfExists(path.join(rootDir, 'scripts'), path.join(releaseDir, 'scripts'));
    await copyIfExists(path.join(rootDir, 'src'), path.join(releaseDir, 'src'));
    await copyIfExists(path.join(rootDir, 'public'), path.join(releaseDir, 'public'));
    await copyIfExists(path.join(rootDir, '.next'), path.join(releaseDir, '.next'));
    await copyIfExists(path.join(rootDir, 'next.config.js'), path.join(releaseDir, 'next.config.js'));
  }

  console.log(`[package-local-release] staged ${releaseDir}`);
}

void stageRelease(target as PlatformTarget);