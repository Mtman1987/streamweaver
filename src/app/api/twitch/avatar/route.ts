import { NextRequest, NextResponse } from 'next/server';
import { getStoredTokens } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);

    // Use avatar from session cookie if available
    if (session?.avatar) {
      return NextResponse.redirect(session.avatar);
    }

    const tokens = await getStoredTokens(session?.tenantId);
    const token = tokens?.broadcasterToken || tokens?.loginToken;
    const username = tokens?.broadcasterUsername || tokens?.loginUsername;
    const clientId = process.env.TWITCH_CLIENT_ID;

    if (!token || !username || !clientId) {
      return new NextResponse(null, { status: 404 });
    }

    const resp = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': clientId },
    });
    if (!resp.ok) return new NextResponse(null, { status: 404 });

    const data = await resp.json() as any;
    const url = data.data?.[0]?.profile_image_url;
    if (!url) return new NextResponse(null, { status: 404 });

    return NextResponse.redirect(url);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
