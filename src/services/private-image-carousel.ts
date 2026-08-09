import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { tenantPath } from '@/lib/tenant';
import { editDiscordMessage, getDiscordMessage } from '@/services/discord-local';

const STORE_FILE = 'data/private-image-carousels.json';
export const PRIVATE_IMAGE_CAROUSEL_INTERVAL_MS = 60_000;

type CarouselRecord = { channelId: string; messageId: string; images: string[]; updatedAt: string };
type CarouselStore = Record<string, CarouselRecord>;
type CarouselDependencies = {
  intervalMs?: number;
  getMessage?: typeof getDiscordMessage;
  editMessage?: typeof editDiscordMessage;
};

const activeRuns = new Map<string, number>();
const storeWrites = new Map<string, Promise<void>>();

function recordKey(channelId: string, messageId: string): string {
  return `${channelId}:${messageId}`;
}

function isDiscordId(value: string): boolean {
  return /^\d{15,22}$/.test(value);
}

function validImages(images: string[]): string[] {
  return images
    .map((value) => String(value || '').trim())
    .filter((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    })
    .filter((value, index, all) => all.indexOf(value) === index);
}

async function readStore(tenantId: string): Promise<CarouselStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(tenantPath(tenantId, STORE_FILE), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStore(tenantId: string, store: CarouselStore): Promise<void> {
  const filePath = tenantPath(tenantId, STORE_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

async function updateStore(tenantId: string, update: (store: CarouselStore) => void): Promise<void> {
  const previous = storeWrites.get(tenantId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const store = await readStore(tenantId);
    update(store);
    const records = Object.entries(store).sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt));
    for (const [key] of records.slice(100)) delete store[key];
    await writeStore(tenantId, store);
  });
  storeWrites.set(tenantId, current);
  try {
    await current;
  } finally {
    if (storeWrites.get(tenantId) === current) storeWrites.delete(tenantId);
  }
}

async function editFrame(record: CarouselRecord, imageUrl: string | null, dependencies: CarouselDependencies, carouselDone = false): Promise<void> {
  const message = await (dependencies.getMessage || getDiscordMessage)(record.channelId, record.messageId) as any;
  const embeds = Array.isArray(message?.embeds)
    ? message.embeds.map((embed: Record<string, unknown>) => ({ ...embed }))
    : [];
  if (!embeds.length) return;
  if (imageUrl) embeds[0].image = { url: imageUrl };
  else delete embeds[0].image;
  if (carouselDone) {
    const { attachPrivateDmControls } = await import('@/services/private-dm-controls');
    const updated = attachPrivateDmControls(embeds, {
      channelId: record.channelId,
      messageId: record.messageId,
      carouselDone: true,
    });
    await (dependencies.editMessage || editDiscordMessage)(record.channelId, record.messageId, { embeds: updated });
    return;
  }
  await (dependencies.editMessage || editDiscordMessage)(record.channelId, record.messageId, { embeds });
}

function beginRun(tenantId: string, record: CarouselRecord, nextIndex: number, dependencies: CarouselDependencies): void {
  const key = `${tenantId}:${recordKey(record.channelId, record.messageId)}`;
  const runId = (activeRuns.get(key) || 0) + 1;
  activeRuns.set(key, runId);
  const schedule = (index: number) => {
    const intervalMs = Math.max(250, dependencies.intervalMs ?? PRIVATE_IMAGE_CAROUSEL_INTERVAL_MS);
    const timer = setTimeout(async () => {
      if (activeRuns.get(key) !== runId) return;
      try {
        if (index < record.images.length) {
          await editFrame(record, record.images[index], dependencies);
          schedule(index + 1);
        } else {
          // Keep the last image visible and change the image control to restart.
          await editFrame(record, record.images[record.images.length - 1], dependencies, true);
          if (activeRuns.get(key) === runId) activeRuns.delete(key);
        }
      } catch (error) {
        activeRuns.delete(key);
        console.warn('[Private Image Carousel] Stopped after Discord edit failed:', error);
      }
    }, intervalMs);
    timer.unref?.();
  };
  schedule(nextIndex);
}

export async function registerPrivateImageCarousel(input: {
  tenantId: string; channelId: string; messageId: string; images: string[];
}, dependencies: CarouselDependencies = {}): Promise<boolean> {
  const images = validImages(input.images);
  if (!input.tenantId || !isDiscordId(input.channelId) || !isDiscordId(input.messageId) || !images.length) return false;
  const record = { channelId: input.channelId, messageId: input.messageId, images, updatedAt: new Date().toISOString() };
  await updateStore(input.tenantId, (store) => {
    store[recordKey(input.channelId, input.messageId)] = record;
  });

  // Own the Discord frame immediately, then advance the remaining images on the timer.
  await editFrame(record, record.images[0], dependencies);
  if (record.images.length > 1) {
    beginRun(input.tenantId, record, 1, dependencies);
  }
  return true;
}

export async function restartPrivateImageCarousel(input: {
  tenantId: string; channelId: string; messageId: string;
}, dependencies: CarouselDependencies = {}): Promise<boolean> {
  if (!input.tenantId || !isDiscordId(input.channelId) || !isDiscordId(input.messageId)) return false;
  const store = await readStore(input.tenantId);
  const record = store[recordKey(input.channelId, input.messageId)];
  if (!record) return false;
  record.images = validImages(record.images);
  if (!record.images.length) return false;
  await editFrame(record, record.images[0], dependencies);
  // Flip control field back from 🔄 to 🖼️
  const message = await (dependencies.getMessage || getDiscordMessage)(record.channelId, record.messageId) as any;
  const embeds = Array.isArray(message?.embeds) ? message.embeds.map((e: Record<string, unknown>) => ({ ...e })) : [];
  if (embeds.length) {
    const { attachPrivateDmControls } = await import('@/services/private-dm-controls');
    const updated = attachPrivateDmControls(embeds, {
      channelId: record.channelId,
      messageId: record.messageId,
      carouselDone: false,
    });
    await (dependencies.editMessage || editDiscordMessage)(record.channelId, record.messageId, { embeds: updated });
  }
  if (record.images.length > 1) {
    beginRun(input.tenantId, record, 1, dependencies);
  }
  return true;
}
