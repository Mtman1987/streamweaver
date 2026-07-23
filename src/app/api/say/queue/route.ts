import { NextRequest, NextResponse } from 'next/server';
import { addSayQueueItem, getSayQueue } from '../_store';
import { resolveSayQueueStreamKey } from '../_stream';
import { generateTTS } from '@/services/tts-provider';
import { hasActiveTtsConsumer } from '@/services/tts-consumer-presence';

export async function POST(request: NextRequest) {
  const { text, tenantId, tenantIds, voice } = await request.json().catch(() => ({ text: '' }));
  if (!text) return NextResponse.json({ ok: false, error: 'empty' });
  const cleanText = String(text).slice(0, 500);
  const requestedTenantIds = Array.isArray(tenantIds) ? tenantIds : [tenantId];
  const queueTenantIds = Array.from(new Set(await Promise.all(requestedTenantIds.map(resolveSayQueueStreamKey))));
  const activeQueueTenantIds = queueTenantIds.filter((id) => hasActiveTtsConsumer(id, 'say'));
  const queueTenantId = activeQueueTenantIds[0] || queueTenantIds[0] || 'global';
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
  const voiceOverride = typeof voice === 'string' && voice.trim() ? voice.trim() : undefined;
  try {
    const audioDataUri = await generateTTS(
      cleanText,
      voiceOverride,
      queueTenantId,
      { requireActiveConsumer: true, consumerScope: 'say' },
    );
    const queued = activeQueueTenantIds.map((id) => {
      const item = addSayQueueItem(id, audioDataUri);
      const sayQueue = getSayQueue(id);
      return { tenantId: id, queued: sayQueue.length, id: item.id };
    });
    return NextResponse.json({ ok: true, tenantId: queueTenantId, queued: queued[0]?.queued || 0, id: queued[0]?.id, queues: queued });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'tts-failed' });
  }
}
