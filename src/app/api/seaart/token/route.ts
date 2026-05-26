import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readUserConfigSync, writeUserConfig } from '@/lib/user-config';
import { z } from 'zod';

const tokenSchema = z.object({ token: z.string().trim().min(1).max(8000) });

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const token = readUserConfigSync(session?.tenantId).SEAART_TOKEN || '';
  return apiOk({ configured: Boolean(token), preview: token ? `${token.slice(0, 6)}...${token.slice(-6)}` : '' });
}

export async function POST(request: NextRequest) {
  try {
    const parsed = tokenSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError('Invalid token', { status: 400, code: 'INVALID_BODY' });
    const session = getTenantFromRequest(request);
    await writeUserConfig({ SEAART_TOKEN: parsed.data.token }, session?.tenantId);
    return apiOk({ success: true });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to save token', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
