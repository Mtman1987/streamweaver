import { NextRequest, NextResponse } from 'next/server';
import { addSayQueueItem, getSayQueue } from '../_store';
import { resolveSayQueueStreamKey } from '../_stream';
import { generateTTS } from '@/services/tts-provider';
import { hasActiveTtsConsumer } from '@/services/tts-consumer-presence';
import { getSayVoicePreference } from '@/services/say-tts';

export async function POST(request: NextRequest) {
  const { text, tenantId, tenantIds, voice, speakerUserId, speakerPlatform } = await request.json().catch(() => ({ text: '' }));
  if (!text) return NextResponse.json({ ok: false, error: 'empty' });

  const cleanText = String(text).slice(0, 500);
  const requestedTenantIds = Array.isArray(tenantIds) ? tenantIds : [tenantId];
  const queueTenantIds = Array.from(new Set(await Promise.all(requestedTenantIds.map(resolveSayQueueStreamKey))));
  const activeQueueTenantIds = queueTenantIds.filter((id) => hasActiveTtsConsumer(id, 'say'));
  const queueTenantId = activeQueueTenantIds[0] || queueTenantIds[0] || 'global';

  // The browser-source Say Player is the canonical public TTS consumer for every
  // platform. Do not synthesize paid speech when no public listener is alive.
  if (activeQueueTenantIds.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'no-active-say-listener',
      tenantId: queueTenantId,
      queued: 0,
      queues: [],
    });
  }

  const explicitVoice = typeof voice === 'string' && voice.trim() ? voice.trim() : undefined;
  const inferredPlatform = String(speakerPlatform || queueTenantId.split(':', 1)[0] || 'discord').trim().toLowerCase();
  const savedVoice = !explicitVoice && speakerUserId
    ? await getSayVoicePreference(speakerUserId, inferredPlatform)
    : undefined;
  const voiceOverride = explicitVoice || savedVoice;

  try {
    const audioDataUri = await generateTTS(
      cleanText,
      voiceOverride,
      queueTenantId,
      { requireActiveConsumer: true, consumerScope: 'say' },
    );
    if (!audioDataUri) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'tts-returned-empty-audio',
        tenantId: queueTenantId,
        queued: 0,
        queues: [],
      });
    }

    const queued = activeQueueTenantIds.map((id) => {
      const item = addSayQueueItem(id, audioDataUri);
      return { tenantId: id, queued: getSayQueue(id).length, id: item.id };
    });
    return NextResponse.json({
      ok: true,
      tenantId: queueTenantId,
      delivered: 'say-player',
      queued: queued[0]?.queued || 0,
      id: queued[0]?.id,
      queues: queued,
      voice: voiceOverride || null,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'tts-failed' }, { status: 502 });
  }
}
