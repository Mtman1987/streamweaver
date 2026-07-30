import { NextRequest, NextResponse } from 'next/server';

import type { SharedChatEventV1, SharedChatPlatform } from '@/contracts/shared-chat-event';
import { getMultiPlatformManager } from '@/services/multi-platform';
import { getKickServiceForTenant } from '@/services/kick';
import { readSharedChatReplay } from '@/services/shared-chat-ingestion';
import { getTwitchStatus } from '@/services/twitch-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEED_PLATFORMS = ['twitch', 'discord', 'kick', 'youtube', 'app', 'social-stream'] as const;

function hasSpmtAccess(request: NextRequest): boolean {
  const supplied = String(request.headers.get('x-spmt-key') || '').trim();
  const expected = String(process.env.SPMT_SYSTEM_KEY || '').trim();
  return Boolean(supplied && expected && supplied === expected);
}

function boundedInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

function timestampMs(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonicalPlatform(event: SharedChatEventV1): string {
  if (event.platform !== 'social-stream') return event.platform;
  const rawProvider = String(event.meta?.rawProvider || '').trim().toLowerCase();
  return ['twitch', 'discord', 'kick', 'youtube'].includes(rawProvider) ? rawProvider : event.platform;
}

function eventFingerprint(event: SharedChatEventV1): string {
  return [
    canonicalPlatform(event),
    event.upstreamId,
    event.channelId,
    event.sender.id,
  ].join(':');
}

function dedupeEvents(events: SharedChatEventV1[]): SharedChatEventV1[] {
  const byFingerprint = new Map<string, SharedChatEventV1>();
  for (const event of events) {
    const key = eventFingerprint(event);
    const existing = byFingerprint.get(key);
    if (!existing || timestampMs(event.receivedTimestamp) >= timestampMs(existing.receivedTimestamp)) {
      byFingerprint.set(key, event);
    }
  }
  return Array.from(byFingerprint.values()).sort((a, b) => (
    timestampMs(a.originalTimestamp) - timestampMs(b.originalTimestamp)
  ));
}

function sourceStatus(
  platform: string,
  recentAt: string | null,
  runtimeConnected: boolean,
): 'live' | 'recent' | 'idle' {
  if (runtimeConnected) return 'live';
  if (recentAt && Date.now() - timestampMs(recentAt) <= 5 * 60_000) return 'recent';
  return 'idle';
}

export async function GET(request: NextRequest) {
  if (!hasSpmtAccess(request)) {
    return NextResponse.json({ error: 'Invalid SPMT service key' }, { status: 401 });
  }

  const tenantId = String(request.headers.get('x-spmt-tenant-id') || '').trim();
  if (!tenantId || tenantId.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(tenantId)) {
    return NextResponse.json({ error: 'A valid tenant id is required' }, { status: 400 });
  }

  const limit = boundedInt(request.nextUrl.searchParams.get('limit'), 100, 200);
  const query = String(request.nextUrl.searchParams.get('q') || '').trim().toLowerCase().slice(0, 120);
  const platformFilter = String(request.nextUrl.searchParams.get('platform') || '').trim().toLowerCase();
  const since = timestampMs(request.nextUrl.searchParams.get('since') || undefined);
  const before = timestampMs(request.nextUrl.searchParams.get('before') || undefined);
  const replay = dedupeEvents(await readSharedChatReplay(tenantId, { limit: 500 }));
  const filtered = replay.filter((event) => {
    const platform = canonicalPlatform(event);
    const eventTime = timestampMs(event.originalTimestamp);
    if (platformFilter && platform !== platformFilter) return false;
    if (since && eventTime <= since) return false;
    if (before && eventTime >= before) return false;
    if (query && !`${event.sender.displayName} ${event.sender.login || ''} ${event.text} ${event.channelName || ''}`.toLowerCase().includes(query)) return false;
    return true;
  });
  const events = filtered.slice(-limit);

  const runtime = getMultiPlatformManager().getStatus();
  const runtimeConnected: Record<string, boolean> = {
    twitch: getTwitchStatus(tenantId) === 'connected',
    kick: Boolean(getKickServiceForTenant(tenantId)?.isConnected()),
    youtube: Boolean(runtime.youtube),
    discord: Boolean(process.env.DISCORD_BOT_TOKEN),
    app: true,
    'social-stream': false,
  };
  const sources = FEED_PLATFORMS.map((platform) => {
    const platformEvents = replay.filter((event) => canonicalPlatform(event) === platform || event.platform === platform);
    const lastEventAt = platformEvents.at(-1)?.originalTimestamp || null;
    return {
      platform,
      status: sourceStatus(platform, lastEventAt, runtimeConnected[platform]),
      runtimeConnected: runtimeConnected[platform],
      eventCount: platformEvents.length,
      lastEventAt,
      readOnly: true,
    };
  });
  const channels = Array.from(new Map(replay.map((event) => {
    const platform = canonicalPlatform(event);
    const id = `${platform}:${event.channelId}`;
    return [id, {
      id,
      platform,
      sourceId: event.sourceId,
      sourceName: event.sourceName || null,
      channelId: event.channelId,
      channelName: event.channelName || event.sourceName || event.channelId,
      lastEventAt: event.originalTimestamp,
      readOnly: true,
    }];
  })).values());

  return NextResponse.json({
    schemaVersion: 1,
    tenantId,
    mode: 'read-only',
    count: events.length,
    capacity: 500,
    hasMore: filtered.length > events.length,
    generatedAt: new Date().toISOString(),
    nextSince: events.at(-1)?.originalTimestamp || request.nextUrl.searchParams.get('since') || null,
    sources,
    channels,
    events,
  }, {
    headers: {
      'cache-control': 'private, no-store',
    },
  });
}
