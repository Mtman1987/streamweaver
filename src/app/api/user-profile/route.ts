import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getStoredTokens } from '@/lib/token-utils.server';
import { readUserConfigSync } from '@/lib/user-config';
import { resolveOverlayTenantId } from '@/lib/overlay-tenant.server';

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const tenantFromQuery = request.nextUrl.searchParams.get('tenant') || undefined;
    const requestedTenant = tenantFromQuery || session?.tenantId;
    const tenantId = await resolveOverlayTenantId(requestedTenant);
    if (!tenantId) {
      return NextResponse.json({}, { status: 401 });
    }

    const fallbackUsername = readUserConfigSync(tenantId).TWITCH_BROADCASTER_USERNAME || '';
    const sameSessionTenant = Boolean(session?.tenantId && session.tenantId === tenantId);
    const displayName = sameSessionTenant
      ? (session?.displayName || session?.username || fallbackUsername)
      : fallbackUsername;

    // Only reuse session presentation data when it belongs to the resolved tenant.
    if (sameSessionTenant && (session?.displayName || session?.avatar)) {
      return NextResponse.json({
        tenantId,
        twitch: {
          id: tenantId,
          name: displayName,
          avatar: session?.avatar || '',
        }
      });
    }

    // Fallback: fetch from Twitch API using the resolved tenant's persisted tokens.
    const tokens = await getStoredTokens(tenantId);
    const token = tokens?.broadcasterToken || tokens?.loginToken;
    if (token && process.env.TWITCH_CLIENT_ID) {
      const res = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.data?.[0]) {
          return NextResponse.json({
            tenantId,
            twitch: {
              id: String(data.data[0].id || tenantId),
              name: data.data[0].display_name,
              avatar: data.data[0].profile_image_url
            }
          });
        }
      }
    }

    return NextResponse.json({
      tenantId,
      twitch: {
        id: tenantId,
        name: displayName || tokens?.broadcasterUsername || tokens?.loginUsername || 'streamer',
        avatar: tokens?.broadcasterAvatarUrl || tokens?.loginAvatarUrl || '',
      }
    });
  } catch {
    return NextResponse.json({});
  }
}
