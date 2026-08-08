import { DISCORD_MEDIA_MAX_FILE_BYTES } from '@/lib/discord-media-limits';

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi']);
const VIDEO_CONTENT_TYPE = /^(?:video\/|application\/(?:octet-stream|quicktime))/i;

function clipWorkerBaseUrl(): string {
  return String(
    process.env.DSH_CLIP_WORKER_URL ||
    process.env.CLIP_WORKER_URL ||
    'https://dsh-clip-worker.fly.dev',
  ).trim().replace(/\/$/, '');
}

function clipWorkerSecret(): string {
  return String(
    process.env.DSH_CLIP_WORKER_SECRET ||
    process.env.DSH_SERVICE_SECRET ||
    process.env.BOT_SECRET_KEY ||
    '',
  ).trim();
}

export function isSupportedDiscordVideoFile(file: Pick<File, 'name' | 'type'>): boolean {
  const extension = String(file.name || '').split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(extension) && (!file.type || VIDEO_CONTENT_TYPE.test(file.type));
}

function isGifBuffer(buffer: Buffer): boolean {
  const signature = buffer.subarray(0, 6).toString('ascii');
  return signature === 'GIF87a' || signature === 'GIF89a';
}

export async function convertDiscordVideoToGif(file: File): Promise<Buffer> {
  if (!isSupportedDiscordVideoFile(file)) {
    throw new Error('Supported video types: MP4, WebM, MOV, M4V, MKV, and AVI.');
  }
  if (file.size <= 0 || file.size > DISCORD_MEDIA_MAX_FILE_BYTES) {
    throw new Error('Video is empty or exceeds the Discord media upload limit.');
  }

  const secret = clipWorkerSecret();
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('DSH_CLIP_WORKER_SECRET is not configured.');
  }

  const formData = new FormData();
  const bytes = new Uint8Array(await file.arrayBuffer());
  formData.append('file', new Blob([bytes], { type: file.type || 'video/mp4' }), file.name || 'discord-media.mp4');
  formData.append('width', String(process.env.DSH_CLIP_WORKER_GIF_WIDTH || 480));
  formData.append('fps', String(process.env.DSH_CLIP_WORKER_GIF_FPS || 15));
  formData.append('durationSeconds', String(process.env.DSH_CLIP_WORKER_MAX_DURATION_SECONDS || 15));
  formData.append('maxOutputBytes', String(DISCORD_MEDIA_MAX_FILE_BYTES));

  const controller = new AbortController();
  const timeoutMs = Math.max(30_000, Number(process.env.DSH_CLIP_WORKER_TIMEOUT_MS || 180_000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${clipWorkerBaseUrl()}/v1/gif`, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
      body: formData,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw new Error('The video-to-GIF worker timed out. Try a shorter video.');
    }
    throw new Error(`The video-to-GIF worker is unavailable: ${(error as Error)?.message || error}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    const detail = String(payload?.error || `HTTP ${response.status}`).replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new Error(`Video conversion failed: ${detail}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || !isGifBuffer(buffer)) {
    throw new Error('The clip worker returned an invalid GIF.');
  }
  if (buffer.length > DISCORD_MEDIA_MAX_FILE_BYTES) {
    throw new Error('The converted GIF is still above the Discord media upload limit.');
  }
  return buffer;
}
