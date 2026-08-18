import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readPrivateChatMessages } from '@/lib/private-chat-store';
import { addLTMEntry } from '@/lib/private-ltm-store';
import { generateAIResponse } from '@/services/ai-provider';
import { hasInternalServiceAccess } from '@/lib/internal-service-auth';
import { z } from 'zod';

const schema = z.object({
  tenantId: z.string().trim().max(128).optional(),
}).optional();

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const internal = hasInternalServiceAccess(request);
    const parsedBody = schema.safeParse(await request.json().catch(() => undefined));
    if (!parsedBody.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const tenantId = session?.tenantId || (internal ? parsedBody.data?.tenantId : undefined);
    if (!tenantId) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }
    if (session?.tenantId && parsedBody.data?.tenantId && parsedBody.data.tenantId !== session.tenantId) {
      return apiError('Forbidden', { status: 403, code: 'TENANT_MISMATCH' });
    }

    const messages = await readPrivateChatMessages(50, tenantId);
    if (messages.length < 10) {
      return apiOk({ success: false, reason: 'Not enough messages to condense' });
    }

    const chatText = messages.map((m) => `${m.username}: ${m.message}`).join('\n');
    const systemPrompt = [
      'You condense private conversations into titled memory entries.',
      'Output valid JSON only with "title" (a short descriptive title) and "content" (a detailed paragraph summarizing key events, emotions, preferences, and important details).',
      'Preserve relevant intimate details and personal context because this output remains in the tenant private-memory store.',
      'Do not include markdown fences or commentary outside the JSON object.',
    ].join(' ');
    const prompt = `Condense this private conversation into one memory entry:\n\n${chatText}\n\nReturn JSON: {"title": "...", "content": "..."}`;

    let raw = '';
    try {
      raw = (await generateAIResponse(
        prompt,
        systemPrompt,
        tenantId,
        { maxTokens: 900, temperature: 0.3 },
      )).trim();
    } catch (error) {
      console.error('[Private LTM] Shared AI condensation failed:', error);
      return apiError('AI condensation failed', { status: 502, code: 'AI_ERROR' });
    }

    let memoryEntry: { title: string; content: string };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      memoryEntry = JSON.parse(jsonMatch?.[0] || raw);
    } catch {
      memoryEntry = { title: `Memory ${new Date().toLocaleDateString()}`, content: raw };
    }

    await addLTMEntry({
      title: memoryEntry.title,
      content: memoryEntry.content,
      createdAt: new Date().toISOString(),
      messageRange: {
        from: messages[0].timestamp,
        to: messages[messages.length - 1].timestamp,
      },
    }, tenantId);

    console.log(`[Private LTM] Condensed: "${memoryEntry.title}" for tenant ${tenantId}`);
    return apiOk({ success: true, title: memoryEntry.title });
  } catch (error) {
    console.error('[Private LTM] Condense error:', error);
    return apiError('Failed to condense', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
