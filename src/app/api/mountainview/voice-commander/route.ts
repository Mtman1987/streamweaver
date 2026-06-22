import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { appendCommanderMemory, isCommander } from '@/lib/commander-memory';
import { z } from 'zod';

const mountainViewVoiceSchema = z.object({
  transcript: z.string().trim().min(1).max(5000).optional(),
  message: z.string().trim().min(1).max(5000).optional(),
  destination: z.enum(['ai', 'private', 'twitch', 'discord']).optional().default('ai'),
  wakeWord: z.string().trim().max(64).optional(),
  tenantId: z.string().trim().max(128).optional(),
  username: z.string().trim().max(128).optional(),
  source: z.string().trim().max(128).optional(),
  payload: z.unknown().optional(),
});

function getBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return request.nextUrl.origin;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data, text };
}

export async function POST(request: NextRequest) {
  try {
    const parsed = mountainViewVoiceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid MountainView voice command payload', {
        status: 400,
        code: 'INVALID_BODY',
        details: parsed.error.flatten(),
      });
    }

    const command = parsed.data;
    const transcript = (command.transcript || command.message || '').trim();
    if (!transcript) {
      return apiError('Missing transcript', { status: 400, code: 'MISSING_TRANSCRIPT' });
    }

    const username = command.username || 'mtman1987';
    const tenantId = command.tenantId || undefined;
    const context = command.destination === 'private' ? 'private' : 'voice';
    const baseUrl = getBaseUrl(request);

    const ai = await postJson(`${baseUrl}/api/ai/chat-with-memory`, {
      username,
      message: transcript,
      tenantId,
      context,
    });

    if (!ai.ok) {
      return apiOk({
        routed: false,
        source: 'mountainview-ai',
        destination: command.destination,
        transcript,
        aiStatus: ai.status,
        error: ai.data?.error || ai.text || 'StreamWeaver AI route failed',
      });
    }

    const reply = String(ai.data?.response || '').trim();
    let tts: { queued: boolean; status?: number; error?: string } = { queued: false };

    if (reply) {
      const ttsResult = await postJson(`${baseUrl}/api/tts`, { text: reply });
      if (ttsResult.ok && ttsResult.data?.audioDataUri) {
        const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
        const current = await postJson(`${baseUrl}/api/tts/current${query}`, {
          audioUrl: ttsResult.data.audioDataUri,
          text: reply,
          source: 'mountainview-ai',
        });
        tts = current.ok
          ? { queued: true, status: current.status }
          : { queued: false, status: current.status, error: current.data?.error || current.text };
      } else {
        tts = { queued: false, status: ttsResult.status, error: ttsResult.data?.error || ttsResult.text };
      }
    }

    if (isCommander(username)) {
      await appendCommanderMemory({
        botName: 'MountainView AI',
        tenantId: tenantId || 'global',
        message: transcript,
        response: reply || '(no response)',
        timestamp: new Date().toISOString(),
      });
    }

    return apiOk({
      routed: true,
      source: 'mountainview-ai',
      destination: command.destination,
      wakeWord: command.wakeWord || null,
      transcript,
      response: reply,
      tts,
    });
  } catch (error) {
    console.error('[MountainView Voice Commander] route failed:', error);
    return apiError('MountainView voice commander failed', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
