import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const chatSendSchema = z.object({
  message: z.string().trim().min(1, 'Message is required').max(500, 'Message too long'),
  as: z.enum(['bot', 'broadcaster']).optional().default('broadcaster'),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = chatSendSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid message or sender', { status: 400, code: 'INVALID_BODY' });
    }

    const { message, as } = parsed.data;
    const wsPort = process.env.WS_PORT || '8090';

    // Proxy to the main server's send-message endpoint to avoid creating
    // a second TMI.js client inside the Next.js process.
    const response = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, as }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return apiError(data.error || 'Failed to send message', { status: response.status, code: 'SEND_FAILED' });
    }

    return apiOk({ success: true });
  } catch (error) {
    console.error('Error in /api/chat/send:', error);
    return apiError('Internal server error', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
