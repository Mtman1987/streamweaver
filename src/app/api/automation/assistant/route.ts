import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';
import { generateAutomationAssistantResponse } from '@/services/automation/ai-workflow-builder';
import { getTenantFromRequest } from '@/lib/tenant-context';

const assistantSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  selectedCommandId: z.string().trim().max(128).optional().nullable(),
  currentWorkflow: z
    .object({
      name: z.string().optional(),
      triggers: z.array(z.any()).optional(),
      subActions: z.array(z.any()).optional(),
    })
    .optional(),
  tenantId: z.string().trim().max(128).optional(),
  userName: z.string().trim().max(128).optional(),
  editCurrentWorkflow: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }
    const parsed = assistantSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Message is required.', { status: 400, code: 'INVALID_BODY' });
    }

    const response = await generateAutomationAssistantResponse({
      ...parsed.data,
      tenantId: session.tenantId,
      userName: parsed.data.userName || session.username,
    });
    return apiOk(response);
  } catch (error: any) {
    console.error('[Automation Assistant] Error:', error);
    return apiError(error?.message || 'Failed to generate automation draft.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
