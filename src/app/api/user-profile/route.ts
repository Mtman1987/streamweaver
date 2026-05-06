import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getStoredTokens } from '@/lib/token-utils.server';
import { readUserConfigSync } from '@/lib/user-config';

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const tenantFromQuery = request.nextUrl.searchParams.get('tenant') || undefined;
    const tenantId = session?.tenantId || tenantFromQuery;
    if (!tenantId) {
      return NextResponse.json({}, { status: 401 });
    }

    const fallbackUsername = readUserConfigSync(tenantId).TWITCH_BROADCASTER_USERNAME || '';
    const displayName = session?.displayName || session?.username || fallbackUsername;

    // Session already has display name + avatar from login
    if (session?.displayName || session?.avatar) {
      return NextResponse.json({
        tenantId,
        twitch: {
          id: tenantId,
          name: displayName,
          avatar: session?.avatar || '',
        }
      });
    }

    // Fallback: fetch from Twitch API using tenant tokens
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
              id: tenantId,
              name: data.data[0].display_name,
              avatar: data.data[0].profile_image_url
            }
          });
        }
      }
    }

    // Last resort: use session username
    return NextResponse.json({
      tenantId,
      twitch: { name: displayName || 'streamer', avatar: '' }
    });
  } catch {
    return NextResponse.json({});
  }
}
