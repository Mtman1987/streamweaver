import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ImageGenerationOptions, ImageGenerationResult } from './image-provider';

const execFileAsync = promisify(execFile);
const CLI_COMMAND_TIMEOUT_MS = 60_000;
const IMAGE_TASK_TIMEOUT_MS = 10 * 60_000;
const VIDEO_TASK_TIMEOUT_MS = 20 * 60_000;
const POLL_INTERVAL_MS = 5_000;
let loginPromise: Promise<void> | null = null;
let loggedInToken = '';

export class SeaArtCliUnavailableError extends Error {}

export type SeaArtCliVideoGenerationOptions = {
  prompt: string;
  firstFrame: string;
  lastFrame?: string;
  modelNo: string;
  modelVerNo: string;
  duration?: number;
  negativePrompt?: string;
  resolution?: string;
  aspectRatio?: string;
};

export type SeaArtCliVideoResult = {
  taskId: string;
  videoResourceUrl: string;
  videoResourceUrls: string[];
  nativeGif: boolean;
  raw: unknown;
};

type SeaArtTaskResult = {
  taskId: string;
  urls: string[];
  output: string;
};

function cliEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.SEAART_CLI_HOME || '/tmp/streamweaver-seaart-cli',
  };
}

async function runSeaArtCli(args: string[], timeout = CLI_COMMAND_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
  const binary = String(process.env.SEAART_CLI_BIN || 'seaart').trim();
  try {
    const result = await execFileAsync(binary, args, {
      env: cliEnvironment(),
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new SeaArtCliUnavailableError(`SeaArt CLI binary not found at ${binary}`);
    }
    const detail = String(error?.stderr || error?.stdout || error?.message || 'unknown CLI error').trim().slice(0, 1_500);
    throw new Error(`SeaArt CLI failed: ${detail}`);
  }
}

async function ensureSeaArtCliLogin(token: string): Promise<void> {
  if (loggedInToken !== token) {
    loginPromise = null;
    loggedInToken = '';
  }
  if (!loginPromise) {
    loginPromise = runSeaArtCli(['login', '--token', token], 30_000)
      .then(() => {
        loggedInToken = token;
      })
      .catch((error) => {
        loginPromise = null;
        loggedInToken = '';
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

function parseJsonValues(output: string): unknown[] {
  const values: unknown[] = [];
  const source = String(output || '').trim();
  if (!source) return values;

  try {
    values.push(JSON.parse(source));
  } catch {
    // CLI output commonly contains progress lines around a final JSON object.
  }

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^data:\s*/i, '');
    if (!trimmed || trimmed === '[DONE]') continue;
    try {
      values.push(JSON.parse(trimmed));
    } catch {
      // Non-JSON lines are handled by the regex fallbacks below.
    }
  }
  return values;
}

function normalizeUrl(value: string): string {
  return value.replace(/[),.;\]}]+$/, '');
}

function looksLikeMediaUrl(value: string, kind: 'image' | 'video'): boolean {
  const url = value.toLowerCase();
  if (!/^https?:\/\//i.test(value)) return false;
  if (/github\.com|docs\.|\/help(?:\/|$)|\/models?(?:\/|$)|\/task(?:\/|$)/i.test(value)) return false;

  if (kind === 'image') {
    return /\.(?:png|jpe?g|webp|gif|avif)(?:\?|$)/i.test(value)
      || /(?:image|img|cdn)[^/]*\.(?:seaart|seaspark)\./i.test(value)
      || /(?:image|img|cdn)/i.test(url);
  }

  return /\.(?:mp4|webm|mov|m4v|gif)(?:\?|$)/i.test(value)
    || /(?:video|cdn)[^/]*\.(?:seaart|seaspark)\./i.test(value)
    || /(?:video|cdn)/i.test(url);
}

function extractSeaArtCliMediaUrls(output: string, kind: 'image' | 'video'): string[] {
  const candidates: string[] = [];
  for (const value of parseJsonValues(output)) collectStrings(value, candidates);
  candidates.push(...(String(output || '').match(/https?:\/\/[^\s"'<>]+/gi) || []));

  return [...new Set(candidates
    .flatMap((value) => String(value).match(/https?:\/\/[^\s"'<>]+/gi) || [])
    .map(normalizeUrl)
    .filter((value) => looksLikeMediaUrl(value, kind)))];
}

export function extractSeaArtCliImageUrls(output: string): string[] {
  return extractSeaArtCliMediaUrls(output, 'image');
}

export function extractSeaArtCliVideoUrls(output: string): string[] {
  return extractSeaArtCliMediaUrls(output, 'video');
}

function collectTaskIds(value: unknown, output: string[], parentKey = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTaskIds(item, output, parentKey));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      typeof child === 'string'
      && child.trim()
      && (
        normalizedKey === 'taskid'
        || normalizedKey === 'taskno'
        || normalizedKey === 'task'
        || (normalizedKey === 'id' && /^(?:data|task|result|output)$/i.test(parentKey))
      )
    ) {
      output.push(child.trim());
    }
    collectTaskIds(child, output, key);
  }
}

export function extractSeaArtCliTaskId(output: string): string {
  const candidates: string[] = [];
  for (const value of parseJsonValues(output)) collectTaskIds(value, candidates);

  const text = String(output || '');
  const patterns = [
    /\btask[_\s-]*id\b\s*[:=]\s*["']?([A-Za-z0-9_-]{6,})/i,
    /\btask[_\s-]*no\b\s*[:=]\s*["']?([A-Za-z0-9_-]{6,})/i,
    /\btask\b\s*[:=]\s*["']?([A-Za-z0-9_-]{6,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) candidates.push(match[1]);
  }

  return candidates.find((value) => value.length >= 6) || '';
}

function taskState(output: string): 'success' | 'failed' | 'pending' | 'unknown' {
  const statusSignals: string[] = [];
  const failureSignals: string[] = [];
  const parsedValues = parseJsonValues(output);

  function inspect(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (!value || typeof value !== 'object') return;

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (typeof child === 'string') {
        const text = child.trim();
        if (text && /^(?:status|state|taskstatus|taskstate|phase|message|msg)$/.test(normalizedKey)) {
          statusSignals.push(text);
        }
        if (text && /(?:error|failure|failreason|reason)$/.test(normalizedKey) && !/^(?:none|null|ok|no error|no errors)$/i.test(text)) {
          failureSignals.push(text);
        }
      }
      inspect(child);
    }
  }

  parsedValues.forEach(inspect);
  if (failureSignals.length) return 'failed';

  const text = statusSignals.join(' ').toLowerCase();
  if (/\b(?:failed|failure|cancelled|canceled|rejected|terminated)\b/.test(text)) return 'failed';
  if (/\b(?:success|succeeded|completed|complete|finished|done)\b/.test(text)) return 'success';
  if (/\b(?:queued|pending|running|processing|generating|in[_ -]?progress|waiting)\b/.test(text)) return 'pending';

  if (!parsedValues.length || !statusSignals.length) {
    const raw = String(output || '').toLowerCase();
    if (/\b(?:failed|failure|cancelled|canceled|rejected|terminated)\b/.test(raw)) return 'failed';
    if (/\b(?:success|succeeded|completed|complete|finished|done)\b/.test(raw)) return 'success';
    if (/\b(?:queued|pending|running|processing|generating|in[_ -]?progress|waiting)\b/.test(raw)) return 'pending';
  }
  return 'unknown';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createAndPollTask(
  args: string[],
  kind: 'image' | 'video',
  timeoutMs: number,
): Promise<SeaArtTaskResult> {
  const createResult = await runSeaArtCli([...args, '--no-wait']);
  const createOutput = `${createResult.stdout}\n${createResult.stderr}`.trim();

  const immediateUrls = extractSeaArtCliMediaUrls(createOutput, kind);
  const taskId = extractSeaArtCliTaskId(createOutput);
  if (immediateUrls.length) {
    return { taskId, urls: immediateUrls, output: createOutput };
  }
  if (!taskId) {
    throw new Error(`SeaArt CLI returned neither media nor a task id: ${createOutput.slice(-1_500)}`);
  }

  const deadline = Date.now() + timeoutMs;
  let lastOutput = createOutput;
  let consecutiveStatusErrors = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const statusResult = await runSeaArtCli(['task', 'status', taskId], 30_000);
      lastOutput = `${statusResult.stdout}\n${statusResult.stderr}`.trim();
      consecutiveStatusErrors = 0;

      const urls = extractSeaArtCliMediaUrls(lastOutput, kind);
      if (urls.length) {
        return { taskId, urls, output: lastOutput };
      }

      const state = taskState(lastOutput);
      if (state === 'failed') {
        throw new Error(`SeaArt task ${taskId} failed: ${lastOutput.slice(-1_500)}`);
      }
      if (state === 'success') {
        throw new Error(`SeaArt task ${taskId} completed but no ${kind} URL was found: ${lastOutput.slice(-1_500)}`);
      }
    } catch (error) {
      if (error instanceof SeaArtCliUnavailableError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/task .* failed|completed but no/i.test(message)) throw error;
      consecutiveStatusErrors += 1;
      console.warn(`[SeaArt CLI] task status poll ${consecutiveStatusErrors} failed for ${taskId}: ${message.slice(0, 500)}`);
      if (consecutiveStatusErrors >= 5) {
        throw new Error(`SeaArt task status polling repeatedly failed for ${taskId}: ${message.slice(0, 1_000)}`);
      }
    }
  }

  throw new Error(`SeaArt task ${taskId} timed out after ${Math.round(timeoutMs / 1000)}s: ${lastOutput.slice(-1_000)}`);
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

  const task = await createAndPollTask(args, 'image', IMAGE_TASK_TIMEOUT_MS);
  return {
    imageResourceUrl: task.urls[0],
    imageResourceUrls: task.urls,
    raw: {
      provider: 'seaart-cli',
      taskId: task.taskId,
      output: task.output.slice(-4_000),
    },
  };
}

export async function generateVideoWithSeaArtCli(
  options: SeaArtCliVideoGenerationOptions,
): Promise<SeaArtCliVideoResult> {
  const token = String(process.env.SEAART_CLI_TOKEN || process.env.SEAART_TOKEN || '').trim();
  if (!token) throw new SeaArtCliUnavailableError('SEAART_CLI_TOKEN is not configured');
  if (!String(options.firstFrame || '').trim()) throw new Error('SeaArt image2video requires firstFrame');

  await ensureSeaArtCliLogin(token);

  const duration = Math.max(1, Math.min(10, Math.round(Number(options.duration || 5) || 5)));
  const args = [
    'image2video',
    '--model-id', String(options.modelNo).trim(),
    '--model-ver-id', String(options.modelVerNo).trim(),
    '--prompt', String(options.prompt || '').trim(),
    '--first-frame', String(options.firstFrame).trim(),
    '--duration', String(duration),
  ];
  if (String(options.lastFrame || '').trim()) args.push('--last-frame', String(options.lastFrame).trim());
  if (String(options.negativePrompt || '').trim()) args.push('--negative-prompt', String(options.negativePrompt).trim());
  if (String(options.resolution || '').trim()) args.push('--resolution', String(options.resolution).trim());
  if (String(options.aspectRatio || '').trim()) args.push('--aspect-ratio', String(options.aspectRatio).trim());

  const task = await createAndPollTask(args, 'video', VIDEO_TASK_TIMEOUT_MS);
  const first = task.urls[0];
  return {
    taskId: task.taskId,
    videoResourceUrl: first,
    videoResourceUrls: task.urls,
    nativeGif: /\.gif(?:\?|$)/i.test(first),
    raw: {
      provider: 'seaart-cli',
      taskId: task.taskId,
      output: task.output.slice(-4_000),
    },
  };
}
