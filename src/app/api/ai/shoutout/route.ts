import { NextRequest } from 'next/server';
import { generateShoutoutAI } from '@/ai/flows/shoutout-ai';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { hasInternalServiceAccess } from '@/lib/internal-service-auth';
import { z } from 'zod';

const shoutoutSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(64),
  personality: z.string().trim().max(1000).optional(),
  tenantId: z.string().trim().max(128).optional(),
});

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const hasServiceAccess = hasInternalServiceAccess(request);
  if (!session?.tenantId && !hasServiceAccess) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }
  const parsed = shoutoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Username is required', { status: 400, code: 'INVALID_BODY' });
  }

  const { username, personality } = parsed.data;
  const tenantId = session?.tenantId || (hasServiceAccess ? parsed.data.tenantId : undefined);
  if (!tenantId) {
    return apiError('Tenant context required', { status: 400, code: 'TENANT_REQUIRED' });
  }

  try {
    const result = await generateShoutoutAI({ username, personality, tenantId });
    return apiOk(result as Record<string, unknown>);
  } catch (error: any) {
    console.error('Shoutout API error:', error);
    return apiOk({
      shoutout: `Go check out ${username} at https://twitch.tv/${username} - they are awesome!`,
    });
  }
}
