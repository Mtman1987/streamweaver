import { NextRequest } from 'next/server';
import { readVault } from '@/lib/vault-store';
import { readAutomationVariables } from '@/lib/automation-variables-store';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    const [vault, variables] = await Promise.all([readVault(), readAutomationVariables()]);
    return apiOk({
      version: 1,
      exportedAt: new Date().toISOString(),
      vault,
      variables,
    });
  } catch (error: any) {
    return apiError(String(error?.message || error), { status: 500, code: 'INTERNAL_ERROR' });
  }
}
