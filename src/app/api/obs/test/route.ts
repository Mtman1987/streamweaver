import { NextRequest } from 'next/server';
import OBSWebSocket from 'obs-websocket-js';
import { updateVault } from '@/lib/vault-store';
import { getTenantFromRequest } from '@/lib/tenant-context';
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

    // Always save settings so the browser-side OBS bridge can use them
    await updateVault({
      obs: { ip, port, url, password: password.trim() },
    });
    // Also save to tenant vault
    const session = getTenantFromRequest(request);
    if (session?.tenantId) {
      await updateVault({ obs: { ip, port, url, password: password.trim() } }, session.tenantId);
    }

    const client = new OBSWebSocket();
    try {
      const pass = password.trim();
      const connectPromise = pass.length > 0
        ? (client as any).connect(url, pass)
        : (client as any).connect(url);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OBS connect timed out')), 8000)
      );
      await Promise.race([connectPromise, timeoutPromise]);

      // Save to Vault on success (non-sensitive config).
      await updateVault({
        obs: {
          ip,
          port,
          url,
          password: pass.length > 0 ? pass : '',
        },
      });

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
