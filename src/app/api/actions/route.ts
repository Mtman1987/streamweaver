import { NextResponse } from 'next/server';
import { getAllActions, createAction } from '@/lib/actions-store';
import type { CreateActionDTO } from '@/types/actions';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const createActionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(128),
  group: z.string().trim().max(128).optional(),
  enabled: z.boolean().optional(),
});

export async function GET() {
  try {
    const actions = await getAllActions();
    return apiOk({ actions });
  } catch (error) {
    console.error('Error fetching actions:', error);
    return apiError('Failed to fetch actions', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Name is required', { status: 400, code: 'INVALID_BODY' });
    }

    const body: CreateActionDTO = parsed.data;

    const action = await createAction({
      name: body.name,
      group: body.group,
      enabled: body.enabled,
    });
    return apiOk(action);
  } catch (error) {
    console.error('Error creating action:', error);
    return apiError('Failed to create action', { status: 500, code: 'INTERNAL_ERROR' });
  }
}