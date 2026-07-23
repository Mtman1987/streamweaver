import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { resolveTenantId } from '@/lib/mountainview-tenant';
import { appendPersonNote } from '@/lib/person-notes-store';

const personNoteSchema = z.object({
  personId: z.string().trim().min(1, 'personId is required').max(128),
  note: z.string().trim().min(1, 'note is required').max(4000),
  consent: z.union([z.boolean(), z.string()]).optional(),
  tenantId: z.string().trim().max(128).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = personNoteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY', details: parsed.error.flatten() });
    }

    const tenantId = resolveTenantId(request, parsed.data.tenantId);
    if (!tenantId) {
      return apiError('Not authenticated', { status: 401, code: 'UNAUTHORIZED' });
    }

    const consent = parsed.data.consent === true || parsed.data.consent === 'true';
    if (!consent) {
      return apiError('Consent is required to store a person note', { status: 400, code: 'CONSENT_REQUIRED' });
    }

    const record = await appendPersonNote(tenantId, {
      personId: parsed.data.personId,
      note: parsed.data.note,
      consent,
    });

    return apiOk({ saved: true, note: record });
  } catch (error) {
    console.error('[Person Note API] Failed:', error);
    return apiError('Failed to save person note', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
