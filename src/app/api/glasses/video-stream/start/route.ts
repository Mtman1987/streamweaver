import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { resolveTenantId } from '@/lib/mountainview-tenant';

// Placeholder endpoint: accepts the MountainView command and acknowledges it so
// the voice flow completes cleanly. The real glasses video relay action is not wired to
// backing infrastructure yet. Wire to the LiveKit/glasses video relay when the relay service exists.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const tenantId = resolveTenantId(request, body?.tenantId);
  console.log(`[Glasses Video Relay API] Acknowledged (tenant: ${tenantId || 'unknown'}) — not yet wired to real infra.`);
  return apiOk({
    accepted: true,
    implemented: false,
    command: 'glasses video relay',
    note: 'Wire to the LiveKit/glasses video relay when the relay service exists.',
  });
}
