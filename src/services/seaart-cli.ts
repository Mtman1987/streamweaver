import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ImageGenerationOptions, ImageGenerationResult } from './image-provider';

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 5 * 60_000;
let loginPromise: Promise<void> | null = null;

export class SeaArtCliUnavailableError extends Error {}

function cliEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.SEAART_CLI_HOME || '/tmp/streamweaver-seaart-cli',
  };
}

async function runSeaArtCli(args: string[], timeout = CLI_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
  const binary = String(process.env.SEAART_CLI_BIN || 'seaart').trim();
  try {
    const result = await execFileAsync(binary, args, {
      env: cliEnvironment(),
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new SeaArtCliUnavailableError(`SeaArt CLI binary not found at ${binary}`);
    }
    const detail = String(error?.stderr || error?.stdout || error?.message || 'unknown CLI error').trim().slice(0, 500);
    throw new Error(`SeaArt CLI failed: ${detail}`);
  }
}

async function ensureSeaArtCliLogin(token: string): Promise<void> {
  if (!loginPromise) {
    loginPromise = runSeaArtCli(['login', '--token', token], 30_000)
      .then(() => undefined)
      .catch((error) => {
        loginPromise = null;
        if (error instanceof SeaArtCliUnavailableError) throw error;
        throw new SeaArtCliUnavailableError(error instanceof Error ? error.message : String(error));
      });
  }
  return loginPromise;
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, output));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => collectStrings(item, output));
  }
}

export function extractSeaArtCliImageUrls(output: string): string[] {
  const candidates: string[] = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^data:\s*/i, '');
    if (!trimmed || trimmed === '[DONE]') continue;
    try {
      collectStrings(JSON.parse(trimmed), candidates);
    } catch {
      candidates.push(...(trimmed.match(/https?:\/\/[^\s"'<>]+/gi) || []));
    }
  }

  return [...new Set(candidates
    .flatMap((value) => value.match(/https?:\/\/[^\s"'<>]+/gi) || [])
    .map((value) => value.replace(/[),.;]+$/, ''))
    .filter((value) => /(?:image|cdn|\.png(?:\?|$)|\.jpe?g(?:\?|$)|\.webp(?:\?|$))/i.test(value)))];
}

export async function generateImageWithSeaArtCli(
  options: ImageGenerationOptions,
  model: { modelNo: string; modelVerNo: string },
): Promise<ImageGenerationResult> {
  const token = String(process.env.SEAART_CLI_TOKEN || process.env.SEAART_TOKEN || '').trim();
  if (!token) throw new SeaArtCliUnavailableError('SEAART_CLI_TOKEN is not configured');

  await ensureSeaArtCliLogin(token);

  const resolution = String(options.resolution || '1024x1024').trim().toLowerCase();
  const count = Math.max(1, Math.min(4, Number(options.numImages || options.providerParams?.count || 1) || 1));
  const args = [
    'text2image',
    '--model-id', model.modelNo,
    '--model-ver-id', model.modelVerNo,
    '--prompt', options.prompt,
    '--resolution', /^\d{3,4}x\d{3,4}$/.test(resolution) ? resolution : '1024x1024',
    '--generate-count', String(count),
  ];
  const seed = Math.floor(Number(options.providerParams?.seed || 0) || 0);
  if (seed > 0) args.push('--seed', String(seed));

  const result = await runSeaArtCli(args);
  const urls = extractSeaArtCliImageUrls(`${result.stdout}\n${result.stderr}`);
  if (!urls.length) {
    throw new Error(`SeaArt CLI completed without an image URL: ${result.stdout.slice(-500)}`);
  }

  return {
    imageResourceUrl: urls[0],
    imageResourceUrls: urls,
    raw: { provider: 'seaart-cli', output: result.stdout.slice(-2_000) },
  };
}
