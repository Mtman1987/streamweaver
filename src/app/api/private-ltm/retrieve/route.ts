import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { retrieveLTMByTitle } from '@/lib/private-ltm-store';
import { z } from 'zod';

const schema = z.object({
  title: z.string().trim().min(1).max(200),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('title is required', { status: 400, code: 'INVALID_BODY' });
    }

    const session = getTenantFromRequest(request);
    const content = await retrieveLTMByTitle(parsed.data.title, session?.tenantId);

    if (!content) {
      return apiOk({ content: `No memory found with title "${parsed.data.title}". It may have been lost during a system update.` });
    }

    return apiOk({ content });
  } catch (error) {
    console.error('[Private LTM] Retrieve error:', error);
    return apiError('Failed to retrieve LTM', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
