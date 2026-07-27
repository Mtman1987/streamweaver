import { NextRequest, NextResponse } from 'next/server';
import { workspaceThemeTokens } from '@spmt/sdk';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('streamweaver-spmt-token')?.value || '';
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const response = await fetch(`${SPMT_BASE_URL}/api/workspace-profile`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.profile) {
    return NextResponse.json({ error: payload?.error || 'Workspace theme unavailable' }, { status: response.status || 502 });
  }

  return NextResponse.json({
    tokens: workspaceThemeTokens(payload.profile, 'streamweaver'),
    revision: payload.profile.revision,
    updatedAt: payload.profile.updatedAt,
  });
}
