import { NextRequest, NextResponse } from 'next/server';
import { addSayQueueItem, getSayQueue, normalizeSayQueueTenant } from '../_store';
import { generateTTS } from '@/services/tts-provider';

export async function POST(request: NextRequest) {
  const { text, tenantId, tenantIds, voice } = await request.json().catch(() => ({ text: '' }));
  if (!text) return NextResponse.json({ ok: false, error: 'empty' });
  const cleanText = String(text).slice(0, 500);
  const requestedTenantIds = Array.isArray(tenantIds) ? tenantIds : [tenantId];
  const queueTenantIds = Array.from(new Set(requestedTenantIds.map(normalizeSayQueueTenant)));
  const queueTenantId = queueTenantIds[0] || 'global';
  const voiceOverride = typeof voice === 'string' && voice.trim() ? voice.trim() : undefined;
  try {
    const audioDataUri = await generateTTS(cleanText, voiceOverride, queueTenantId === 'global' ? undefined : queueTenantId);
    const queued = queueTenantIds.map((id) => {
      const item = addSayQueueItem(id, audioDataUri);
      const sayQueue = getSayQueue(id);
      return { tenantId: id, queued: sayQueue.length, id: item.id };
    });
    return NextResponse.json({ ok: true, tenantId: queueTenantId, queued: queued[0]?.queued || 0, id: queued[0]?.id, queues: queued });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'tts-failed' });
  }
}
