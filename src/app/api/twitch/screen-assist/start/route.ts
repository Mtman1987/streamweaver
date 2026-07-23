import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { resolveTenantId } from '@/lib/mountainview-tenant';

// Placeholder endpoint: accepts the MountainView command and acknowledges it so
// the voice flow completes cleanly. The real Twitch screen assist action is not wired to
// backing infrastructure yet. Wire to the screen-assist capture/vision pipeline when available.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const tenantId = resolveTenantId(request, body?.tenantId);
  console.log(`[Twitch Screen Assist API] Acknowledged (tenant: ${tenantId || 'unknown'}) — not yet wired to real infra.`);
  return apiOk({
    accepted: true,
    implemented: false,
    command: 'Twitch screen assist',
    note: 'Wire to the screen-assist capture/vision pipeline when available.',
  });
}
