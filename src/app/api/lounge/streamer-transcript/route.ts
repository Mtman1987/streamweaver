import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { SPACEMOUNTAIN_SYSTEM_TENANT_ID } from '@/lib/tenant';
import { noteStreamerSpeech, stellaThoughtBoard } from '@/services/stella-thought-board';

export const dynamic = 'force-dynamic';

function clean(value: unknown) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const text = clean(body.text || body.transcript);
  if (!text) return NextResponse.json({ error: 'Transcript text is required.' }, { status: 400 });

  // This route is intentionally scoped to the SpaceMountain Lounge. It accepts
  // the authenticated broadcaster's transcript and feeds only Stella's
  // short-lived co-host context; it does not publish the transcript to chat.
  noteStreamerSpeech(text);
  return NextResponse.json({ ok: true, tenant: SPACEMOUNTAIN_SYSTEM_TENANT_ID, thoughtBoard: stellaThoughtBoard() });
}
