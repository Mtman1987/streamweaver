import { getInternalAppUrl } from '@/lib/runtime-origin';
import { hasActiveTtsConsumer } from '@/services/tts-consumer-presence';
import { internalServiceHeaders } from '@/lib/internal-service-auth';

export type QueueTtsOverlayResult = {
  ok: boolean;
  generated: boolean;
  queued: boolean;
  error?: string;
};

export async function queueTtsOverlay(text: string, tenantId?: string): Promise<QueueTtsOverlayResult> {
    if (!hasActiveTtsConsumer(tenantId)) {
        return {
            ok: true,
            generated: false,
            queued: false,
            error: 'Skipped paid TTS because no tenant overlay/listener is active',
        };
    }
  const cleanText = String(text || '').trim();
  if (!cleanText) return { ok: false, generated: false, queued: false, error: 'empty text' };

  try {
    const baseUrl = getInternalAppUrl();
    const headers = internalServiceHeaders({ 'Content-Type': 'application/json' });
    const ttsRes = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: cleanText.slice(0, 2000),
        tenantId,
      }),
    });
    if (!ttsRes.ok) {
      return { ok: false, generated: false, queued: false, error: `TTS generation failed: HTTP ${ttsRes.status}` };
    }

    const ttsData = await ttsRes.json().catch(() => null);
    const audioUrl = typeof ttsData?.audioDataUri === 'string' ? ttsData.audioDataUri : '';
    if (!audioUrl) return { ok: false, generated: true, queued: false, error: 'TTS generation returned no audioDataUri' };

    const tenantQuery = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
    const queueRes = await fetch(`${baseUrl}/api/tts/current${tenantQuery}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ audioUrl }),
    });
    if (!queueRes.ok) {
      return { ok: false, generated: true, queued: false, error: `TTS queue failed: HTTP ${queueRes.status}` };
    }

    return { ok: true, generated: true, queued: true };
  } catch (error) {
    return {
      ok: false,
      generated: false,
      queued: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
