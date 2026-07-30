import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const runtimeDir = path.join(rootDir, 'dist', 'companion-runtime');
const runtimeNode = path.join(runtimeDir, process.platform === 'win32' ? 'node.exe' : 'bin/node');
const stdoutPath = path.join(runtimeDir, 'smoke.stdout.log');
const stderrPath = path.join(runtimeDir, 'smoke.stderr.log');

const tsconfig = JSON.parse(await fsp.readFile(path.join(runtimeDir, 'tsconfig.json'), 'utf8'));
if (!Array.isArray(tsconfig?.compilerOptions?.paths?.['@/*'])
  || !tsconfig.compilerOptions.paths['@/*'].includes('./src/*')) {
  throw new Error('Packaged runtime is missing the @/* TypeScript path alias');
}

const stdoutHandle = await fsp.open(stdoutPath, 'w');
const stderrHandle = await fsp.open(stderrPath, 'w');
const child = spawn(runtimeNode, ['node_modules/tsx/dist/cli.mjs', 'server.ts'], {
  cwd: runtimeDir,
  windowsHide: true,
  stdio: ['ignore', stdoutHandle.fd, stderrHandle.fd],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    STREAMWEAVER_PACKAGED_RUNTIME: '1',
    SERVER_HOST: '127.0.0.1',
    PORT: '3210',
    WS_PORT: '8190',
    NEXT_PUBLIC_STREAMWEAVE_PORT: '3210',
    OPEN_BROWSER: 'false',
  },
});

async function readTail(target) {
  return (await fsp.readFile(target, 'utf8').catch(() => '')).slice(-8000);
}

try {
  let health;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    try {
      const response = await fetch('http://127.0.0.1:3210/api/health');
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // Runtime is still starting.
    }
  }
  if (!health) {
    throw new Error(`Packaged runtime health failed.\nSTDOUT:\n${await readTail(stdoutPath)}\nSTDERR:\n${await readTail(stderrPath)}`);
  }
  let stdout = '';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    stdout = await readTail(stdoutPath);
    if (stdout.includes('ALL SERVICES READY')) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const stderr = await readTail(stderrPath);
  if (!stdout.includes('ALL SERVICES READY') || stderr.includes('ERR_PACKAGE_PATH_NOT_EXPORTED')) {
    throw new Error(`Packaged runtime did not finish starting cleanly.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
  console.log(JSON.stringify(health));
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  await stdoutHandle.close();
  await stderrHandle.close();
  await fsp.rm(stdoutPath, { force: true });
  await fsp.rm(stderrPath, { force: true });
}
