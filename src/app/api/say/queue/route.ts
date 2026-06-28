import { NextRequest, NextResponse } from 'next/server';
import { getSayQueue, normalizeSayQueueTenant } from '../_store';
import { generateTTS } from '@/services/tts-provider';

export async function POST(request: NextRequest) {
  const { text, tenantId } = await request.json().catch(() => ({ text: '' }));
  if (!text) return NextResponse.json({ ok: false, error: 'empty' });
  const cleanText = String(text).slice(0, 500);
  const queueTenantId = normalizeSayQueueTenant(tenantId);
  try {
    const audioDataUri = await generateTTS(cleanText, undefined, queueTenantId === 'global' ? undefined : queueTenantId);
    const sayQueue = getSayQueue(queueTenantId);
    sayQueue.push(audioDataUri);
    return NextResponse.json({ ok: true, tenantId: queueTenantId, queued: sayQueue.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'tts-failed' });
  }
}
