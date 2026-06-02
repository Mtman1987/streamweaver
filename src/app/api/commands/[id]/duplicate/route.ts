import { NextRequest } from 'next/server';
import { duplicateCommand } from '@/lib/commands-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getTenantFromRequest(request);
    const duplicated = await duplicateCommand(id, session?.tenantId);
    if (!duplicated) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk(duplicated);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to duplicate command.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
