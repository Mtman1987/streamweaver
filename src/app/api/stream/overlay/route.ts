import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { resolveTenantId } from '@/lib/mountainview-tenant';

// Placeholder endpoint: accepts the MountainView command and acknowledges it so
// the voice flow completes cleanly. The real stream overlay trigger action is not wired to
// backing infrastructure yet. Wire to the WS broadcast/overlay pipeline when the overlay event schema is finalized.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const tenantId = resolveTenantId(request, body?.tenantId);
  console.log(`[Stream Overlay API] Acknowledged (tenant: ${tenantId || 'unknown'}) — not yet wired to real infra.`);
  return apiOk({
    accepted: true,
    implemented: false,
    command: 'stream overlay trigger',
    note: 'Wire to the WS broadcast/overlay pipeline when the overlay event schema is finalized.',
  });
}
