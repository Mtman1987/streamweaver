import { NextRequest } from 'next/server';
import { getAllActions, createAction } from '@/lib/actions-store';
import type { CreateActionDTO } from '@/types/actions';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

const createActionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(128),
  group: z.string().trim().max(128).optional(),
  enabled: z.boolean().optional(),
  alwaysRun: z.boolean().optional(),
  randomAction: z.boolean().optional(),
  concurrent: z.boolean().optional(),
  excludeFromHistory: z.boolean().optional(),
  excludeFromPending: z.boolean().optional(),
  queue: z.string().trim().max(128).optional(),
  triggers: z.array(z.any()).optional(),
  subActions: z.array(z.any()).optional(),
}).passthrough();

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const actions = await getAllActions(session?.tenantId);
    return apiOk({ actions });
  } catch (error) {
    console.error('Error fetching actions:', error);
    return apiError('Failed to fetch actions', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const parsed = createActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Name is required', { status: 400, code: 'INVALID_BODY' });
    }

    const body = parsed.data as CreateActionDTO & Record<string, any>;

    const action = await createAction({
      ...body,
      name: body.name,
      group: body.group,
      enabled: body.enabled,
    }, session?.tenantId);
    return apiOk(action);
  } catch (error) {
    console.error('Error creating action:', error);
    return apiError('Failed to create action', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
