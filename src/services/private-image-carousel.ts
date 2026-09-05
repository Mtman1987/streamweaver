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

function storePath(tenantId: string): string {
  return tenantPath(tenantId, STORE_FILE);
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

function errorDetails(error: unknown): Record<string, unknown> {
  const candidate = error as any;
  return {
    name: candidate?.name || undefined,
    code: candidate?.code || undefined,
    status: candidate?.status || undefined,
    message: error instanceof Error ? error.message : String(error),
    body: candidate?.body || undefined,
  };
}

async function readStore(tenantId: string): Promise<CarouselStore> {
  const filePath = storePath(tenantId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Private image carousel store is not a JSON object.');
    }
    return parsed as CarouselStore;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    console.error(`[Private Image Carousel] Store read failed: ${JSON.stringify({
      tenantId,
      filePath,
      ...errorDetails(error),
    })}`);
    throw error;
  }
}

async function writeStore(tenantId: string, store: CarouselStore): Promise<void> {
  const filePath = storePath(tenantId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    console.error(`[Private Image Carousel] Store write failed: ${JSON.stringify({
      tenantId,
      filePath,
      temporaryPath,
      recordCount: Object.keys(store).length,
      ...errorDetails(error),
    })}`);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
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
  let message: any;
  try {
    message = await (dependencies.getMessage || getDiscordMessage)(record.channelId, record.messageId) as any;
  } catch (error) {
    console.warn(`[Private Image Carousel] Discord get-message failed: ${JSON.stringify({
      channelId: record.channelId,
      messageId: record.messageId,
      ...errorDetails(error),
    })}`);
    throw error;
  }

  const embeds = Array.isArray(message?.embeds)
    ? message.embeds.map((embed: Record<string, unknown>) => ({ ...embed }))
    : [];
  if (!embeds.length) {
    console.warn(`[Private Image Carousel] Discord message has no embeds: ${JSON.stringify({
      channelId: record.channelId,
      messageId: record.messageId,
    })}`);
    return;
  }

  if (imageUrl) embeds[0].image = { url: imageUrl };
  else delete embeds[0].image;

  let nextEmbeds = embeds;
  if (carouselDone) {
    const { attachPrivateDmControls } = await import('@/services/private-dm-controls');
    nextEmbeds = attachPrivateDmControls(embeds, {
      channelId: record.channelId,
      messageId: record.messageId,
      carouselDone: true,
    });
  }

  try {
    await (dependencies.editMessage || editDiscordMessage)(record.channelId, record.messageId, { embeds: nextEmbeds });
  } catch (error) {
    console.warn(`[Private Image Carousel] Discord patch-message failed: ${JSON.stringify({
      channelId: record.channelId,
      messageId: record.messageId,
      carouselDone,
      ...errorDetails(error),
    })}`);
    throw error;
  }
}

function beginRun(tenantId: string, record: CarouselRecord, nextIndex: number, dependencies: CarouselDependencies): void {
  const key = `${tenantId}:${recordKey(record.channelId, record.messageId)}`;
  const runId = (activeRuns.get(key) || 0) + 1;
  activeRuns.set(key, runId);
  const schedule = (index: number) => {
    const intervalMs = Math.max(250, dependencies.intervalMs ?? PRIVATE_IMAGE_CAROUSEL_INTERVAL_MS);
    const timer = setTimeout(async () => {
      if (activeRuns.get(key) !== runId) return;
      console.log(`[Private Image Carousel] Tick: ${JSON.stringify({
        tenantId,
        channelId: record.channelId,
        messageId: record.messageId,
        index,
        totalImages: record.images.length,
        finalizing: index >= record.images.length,
      })}`);
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
        console.warn(`[Private Image Carousel] Stopped after Discord operation failed: ${JSON.stringify({
          tenantId,
          channelId: record.channelId,
          messageId: record.messageId,
          index,
          totalImages: record.images.length,
          ...errorDetails(error),
        })}`);
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
  const key = recordKey(input.channelId, input.messageId);
  const record = { channelId: input.channelId, messageId: input.messageId, images, updatedAt: new Date().toISOString() };

  await updateStore(input.tenantId, (store) => {
    store[key] = record;
  });

  // Verify that the write is immediately readable before any timer is started.
  const persistedStore = await readStore(input.tenantId);
  const persistedRecord = persistedStore[key];
  if (
    !persistedRecord ||
    persistedRecord.channelId !== record.channelId ||
    persistedRecord.messageId !== record.messageId ||
    !Array.isArray(persistedRecord.images) ||
    persistedRecord.images.length !== record.images.length
  ) {
    throw new Error(`Private image carousel persistence verification failed for ${key}.`);
  }

  console.log(`[Private Image Carousel] Registered: ${JSON.stringify({
    tenantId: input.tenantId,
    channelId: input.channelId,
    messageId: input.messageId,
    imageCount: images.length,
    storePath: storePath(input.tenantId),
    persisted: true,
  })}`);

  // Own the Discord frame immediately, then advance the remaining images on the timer.
  await editFrame(record, record.images[0], dependencies);
  console.log(`[Private Image Carousel] Initial frame confirmed: ${JSON.stringify({
    tenantId: input.tenantId,
    channelId: input.channelId,
    messageId: input.messageId,
  })}`);

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
  if (!record) {
    console.warn(`[Private Image Carousel] Restart record missing: ${JSON.stringify({
      tenantId: input.tenantId,
      channelId: input.channelId,
      messageId: input.messageId,
      storePath: storePath(input.tenantId),
    })}`);
    return false;
  }
  record.images = validImages(record.images);
  if (!record.images.length) return false;
  await editFrame(record, record.images[0], dependencies);
  // Flip control field back from 🔄 to 🖼️
  let message: any;
  try {
    message = await (dependencies.getMessage || getDiscordMessage)(record.channelId, record.messageId) as any;
  } catch (error) {
    console.warn(`[Private Image Carousel] Discord restart get-message failed: ${JSON.stringify({
      channelId: record.channelId,
      messageId: record.messageId,
      ...errorDetails(error),
    })}`);
    throw error;
  }
  const embeds = Array.isArray(message?.embeds) ? message.embeds.map((e: Record<string, unknown>) => ({ ...e })) : [];
  if (embeds.length) {
    const { attachPrivateDmControls } = await import('@/services/private-dm-controls');
    const updated = attachPrivateDmControls(embeds, {
      channelId: record.channelId,
      messageId: record.messageId,
      carouselDone: false,
    });
    try {
      await (dependencies.editMessage || editDiscordMessage)(record.channelId, record.messageId, { embeds: updated });
    } catch (error) {
      console.warn(`[Private Image Carousel] Discord restart patch-message failed: ${JSON.stringify({
        channelId: record.channelId,
        messageId: record.messageId,
        ...errorDetails(error),
      })}`);
      throw error;
    }
  }
  if (record.images.length > 1) {
    beginRun(input.tenantId, record, 1, dependencies);
  }
  return true;
}
