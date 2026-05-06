import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getStoredTokens } from '@/lib/token-utils.server';
import { getActiveTenantIds } from '@/services/twitch-client';

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return NextResponse.json({ channels: [] });
    }

    const tokens = await getStoredTokens(session.tenantId);
    const broadcaster = (
      tokens?.broadcasterUsername ||
      tokens?.loginUsername ||
      session.username ||
      ''
    ).toLowerCase();

    if (!broadcaster) {
      return NextResponse.json({ channels: [] });
    }

    const activeTenants = new Set(getActiveTenantIds());
    const joined = activeTenants.has(session.tenantId);

    return NextResponse.json({
      channels: [
        {
          name: broadcaster,
          status: joined ? 'joined' : 'pending',
        },
      ],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load channels' },
      { status: 500 }
    );
  }
}
