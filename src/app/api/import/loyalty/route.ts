import { getStoredTokens } from '@/lib/token-utils.server';
import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest, toStorageContext } from '@/lib/tenant-context';
import { previewLoyaltyImport, applyLoyaltyImport } from '@/services/loyalty-import';
export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Sign in to import your channel data.',{status:401});
  if (Number(request.headers.get('content-length') || 0) > 2_100_000) return apiError('File is too large.',{status:413});
  const body = await request.json().catch(()=>null);
  if (!body || !['preview','apply'].includes(body.action) || typeof body.text !== 'string' || !['minutes','seconds','hours'].includes(body.unit)) return apiError('Choose a CSV or JSON file and watchtime unit.',{status:400});
  try {
    const tokens = await getStoredTokens(session.tenantId);
    const ctx = { ...toStorageContext(session), username: String(tokens?.broadcasterUsername || session.username).toLowerCase() };
    return apiOk(body.action === 'preview' ? await previewLoyaltyImport(body.text,body.unit,ctx) : await applyLoyaltyImport(body.text,body.unit,String(body.digest || ''),ctx));
  } catch (error) { return apiError(error instanceof Error ? error.message : 'Import failed. Retrying the same file will not double balances.',{status:400}); }
}
