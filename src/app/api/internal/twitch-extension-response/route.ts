import { NextRequest } from 'next/server';
import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-response';
import { authorizeSpmtCoreService } from '@/lib/spmt-incoming-service-auth';
import { getInternalAppUrl } from '@/lib/runtime-origin';
import { internalServiceHeaders } from '@/lib/internal-service-auth';
import { queueTtsOverlay } from '@/services/tts-overlay-queue';

const RequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128),
  broadcasterLogin: z.string().trim().min(1).max(128),
  viewerId: z.string().trim().min(1).max(180),
  promptId: z.string().trim().min(1).max(120),
  promptText: z.string().trim().min(1).max(500),
  choice: z.string().trim().min(1).max(80),
});

export async function POST(request: NextRequest) {
  if (!(await authorizeSpmtCoreService(request, 'commlink:control'))) {
    return apiError('SPMT service authentication required', { status: 401, code: 'UNAUTHORIZED' });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid Twitch Extension response', { status: 400, code: 'INVALID_BODY' });

  const input = parsed.data;
  const viewerLabel = `extension-viewer-${input.viewerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-20) || 'guest'}`;
  const message = [
    `The viewer clicked "${input.choice}" in response to your on-screen question: "${input.promptText}".`,
    'Treat this as their direct answer to you. Continue the conversation naturally in one short spoken response.',
    'Do not mention the Twitch Extension, buttons, internal tags, or implementation details.',
  ].join(' ');

  try {
    const response = await fetch(`${getInternalAppUrl()}/api/ai/chat-with-memory`, {
      method: 'POST',
      headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username: viewerLabel,
        userId: input.viewerId,
        displayName: 'Twitch viewer',
        message,
        tenantId: input.tenantId,
        context: 'twitch',
      }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok || !payload?.data?.response) {
      return apiError(payload?.error || 'Stella could not process the viewer response', {
        status: 502,
        code: 'AI_RESPONSE_FAILED',
      });
    }

    const spoken = String(payload.data.response).trim();
    const tts = await queueTtsOverlay(spoken, input.tenantId);
    if (!tts.ok) {
      return apiError(tts.error || 'Stella response could not be queued for TTS', {
        status: 502,
        code: 'TTS_FAILED',
      });
    }

    return apiOk({
      ok: true,
      promptId: input.promptId,
      choice: input.choice,
      response: spoken,
      tts,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Viewer response failed', {
      status: 500,
      code: 'VIEWER_RESPONSE_FAILED',
    });
  }
}
