import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readPrivateChatMessages } from '@/lib/private-chat-store';
import { addLTMEntry } from '@/lib/private-ltm-store';
import { z } from 'zod';

const schema = z.object({
  tenantId: z.string().trim().max(128).optional(),
}).optional();

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const parsedBody = schema.safeParse(await request.json().catch(() => undefined));
    const tenantId = session?.tenantId || (parsedBody.success ? parsedBody.data?.tenantId : undefined);

    const messages = await readPrivateChatMessages(50, tenantId);
    if (messages.length < 10) {
      return apiOk({ success: false, reason: 'Not enough messages to condense' });
    }

    const chatText = messages.map((m) => `${m.username}: ${m.message}`).join('\n');

    const edenaiKey = process.env.EDENAI_API_KEY;
    if (!edenaiKey) {
      return apiError('Missing AI key', { status: 500, code: 'MISSING_CONFIG' });
    }

    const res = await fetch('https://api.edenai.run/v3/llm/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${edenaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash',
        messages: [
          { role: 'system', content: 'You condense conversations into titled memory entries. Output JSON with "title" (short descriptive title) and "content" (detailed paragraph summarizing key events, emotions, preferences, and important details). Preserve intimate details and personal context.' },
          { role: 'user', content: `Condense this private conversation into a memory entry:\n\n${chatText}\n\nRespond with JSON: {"title": "...", "content": "..."}` },
        ],
        stream: false,
      }),
    });

    if (!res.ok) {
      console.error('[Private LTM] Condense AI failed:', res.status);
      return apiError('AI condensation failed', { status: 502 });
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

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

    console.log(`[Private LTM] Condensed: "${memoryEntry.title}" for tenant ${tenantId || 'global'}`);
    return apiOk({ success: true, title: memoryEntry.title });
  } catch (error) {
    console.error('[Private LTM] Condense error:', error);
    return apiError('Failed to condense', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
