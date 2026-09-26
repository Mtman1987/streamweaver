import { getInternalAppUrl } from '@/lib/runtime-origin';
import { readPrivateChatMessages, type PrivateChatMessage } from '@/lib/private-chat-store';
import { hasActiveTtsConsumer } from '@/services/tts-consumer-presence';
import { internalServiceHeaders } from '@/lib/internal-service-auth';
import { consumeAvatarGesture } from '@/lib/avatar-gesture-runtime';
import { consumeViewerActionPrompt } from '@/lib/viewer-action-runtime';

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

export type PreparedTtsOverlay = {
  result: QueueTtsOverlayResult;
  audioUrl?: string;
};

export async function prepareTtsOverlay(text: string, tenantId?: string): Promise<PreparedTtsOverlay> {
  const cleanText = String(text || '').trim();
  if (!cleanText) return { result: { ok: false, generated: false, queued: false, error: 'empty text' } };

  // Private Discord replies use their own one-shot speaker control.
  if (await isRecentPrivateDiscordReply(cleanText, tenantId)) {
    return { result: {
      ok: true, generated: false, queued: false,
      error: 'Skipped automatic stream TTS for a private Discord reply; use the private speaker control',
    } };
  }
  if (!hasActiveTtsConsumer(tenantId)) {
    return { result: {
      ok: true, generated: false, queued: false,
      error: 'Skipped paid TTS because no tenant overlay/listener is active',
    } };
  }
  try {
    const ttsRes = await fetch(`${getInternalAppUrl()}/api/tts`, {
      method: 'POST',
      headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text: cleanText.slice(0, 2000), tenantId }),
    });
    if (!ttsRes.ok) return { result: { ok: false, generated: false, queued: false, error: `TTS generation failed: HTTP ${ttsRes.status}` } };
    const ttsData = await ttsRes.json().catch(() => null);
    const audioUrl = typeof ttsData?.audioDataUri === 'string' ? ttsData.audioDataUri : '';
    if (!audioUrl) return { result: { ok: false, generated: true, queued: false, error: 'TTS generation returned no audioDataUri' } };
    return { result: { ok: true, generated: true, queued: false }, audioUrl };
  } catch (error) {
    return { result: {
      ok: false, generated: false, queued: false,
      error: error instanceof Error ? error.message : String(error),
    } };
  }
}

export async function queuePreparedTtsOverlay(
  text: string, audioUrl: string, tenantId?: string,
): Promise<QueueTtsOverlayResult> {
  const cleanText = String(text || '').trim();
  if (!audioUrl || !cleanText) return { ok: false, generated: Boolean(audioUrl), queued: false, error: 'Missing audio or text' };
  try {
    const tenantQuery = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
    const queueRes = await fetch(`${getInternalAppUrl()}/api/tts/current${tenantQuery}`, {
      method: 'POST',
      headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        audioUrl,
        text: cleanText.slice(0, 2000),
        gesture: consumeAvatarGesture(tenantId, cleanText),
        viewerPrompt: consumeViewerActionPrompt(tenantId, cleanText),
      }),
    });
    if (!queueRes.ok) return { ok: false, generated: true, queued: false, error: `TTS queue failed: HTTP ${queueRes.status}` };
    return { ok: true, generated: true, queued: true };
  } catch (error) {
    return { ok: false, generated: true, queued: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function queueTtsOverlay(text: string, tenantId?: string): Promise<QueueTtsOverlayResult> {
  const prepared = await prepareTtsOverlay(text, tenantId);
  return prepared.audioUrl
    ? queuePreparedTtsOverlay(text, prepared.audioUrl, tenantId)
    : prepared.result;
}
