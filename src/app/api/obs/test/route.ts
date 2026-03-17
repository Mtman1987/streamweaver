import { NextRequest } from 'next/server';
import OBSWebSocket from 'obs-websocket-js';
import { updateVault } from '@/lib/vault-store';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const obsTestSchema = z.object({
  ip: z
    .string()
    .trim()
    .min(1, 'Missing ip')
    .max(255, 'Invalid ip')
    .regex(/^[a-zA-Z0-9.:-]+$/, 'Invalid ip'),
  port: z.coerce.number().int().min(1, 'Invalid port').max(65535, 'Invalid port'),
  password: z.string().max(256, 'Password too long').optional().default(''),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = obsTestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { ip, port, password } = parsed.data;

    const url = `ws://${ip}:${port}`;

    const client = new OBSWebSocket();
    try {
      const pass = password.trim();
      if (pass.length > 0) {
        await (client as any).connect(url, pass);
      } else {
        await (client as any).connect(url);
      }

      // Save to Vault on success (non-sensitive config).
      await updateVault({ obs: { ip, port, password: pass.length > 0 ? pass : '' } });

      try {
        await (client as any).disconnect?.();
      } catch {
        // ignore
      }

      return apiOk({ success: true, url });
    } finally {
      try {
        await (client as any).disconnect?.();
      } catch {
        // ignore
      }
    }
  } catch (error: any) {
    return apiError(String(error?.message || error), { status: 500, code: 'INTERNAL_ERROR' });
  }
}
