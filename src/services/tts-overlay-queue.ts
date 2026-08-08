import { getInternalAppUrl } from '@/lib/runtime-origin';
import { readPrivateChatMessages, type PrivateChatMessage } from '@/lib/private-chat-store';
import { hasActiveTtsConsumer } from '@/services/tts-consumer-presence';
import { internalServiceHeaders } from '@/lib/internal-service-auth';

export type QueueTtsOverlayResult = {
  ok: boolean;
  generated: boolean;
  queued: boolean;
  error?: string;
};

const RECENT_PRIVATE_REPLY_WINDOW_MS = 2 * 60 * 1000;

function normalizeTtsComparisonText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isMatchingRecentPrivateReply(
  text: string,
  messages: PrivateChatMessage[],
  nowMs = Date.now(),
  maxAgeMs = RECENT_PRIVATE_REPLY_WINDOW_MS,
): boolean {
  const cleanText = normalizeTtsComparisonText(text);
  if (!cleanText) return false;

  for (let index = messages.length - 1; index >= 0; index--) {
    const entry = messages[index];
    if (entry.type !== 'ai') continue;
    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp) || nowMs - timestamp < 0 || nowMs - timestamp > maxAgeMs) return false;
    return normalizeTtsComparisonText(entry.message) === cleanText;
  }

  return false;
}

async function isRecentPrivateDiscordReply(text: string, tenantId?: string): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const recentMessages = await readPrivateChatMessages(4, tenantId);
    return isMatchingRecentPrivateReply(text, recentMessages);
  } catch {
    return false;
  }
}

export async function queueTtsOverlay(text: string, tenantId?: string): Promise<QueueTtsOverlayResult> {
  const cleanText = String(text || '').trim();
  if (!cleanText) return { ok: false, generated: false, queued: false, error: 'empty text' };

  // Private Discord replies are saved to the tenant's private-chat history
  // immediately before the shared Discord delivery code reaches this helper.
  // Do not send that private text to an OBS/listener queue. The signed speaker
  // icon on the private embed provides one-shot browser TTS instead.
  if (await isRecentPrivateDiscordReply(cleanText, tenantId)) {
    return {
      ok: true,
      generated: false,
      queued: false,
      error: 'Skipped automatic stream TTS for a private Discord reply; use the private speaker control',
    };
  }

  if (!hasActiveTtsConsumer(tenantId)) {
    return {
      ok: true,
      generated: false,
      queued: false,
      error: 'Skipped paid TTS because no tenant overlay/listener is active',
    };
  }

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
