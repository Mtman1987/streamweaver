import { NextRequest, NextResponse } from 'next/server';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { saveStreamElementsToken } from '@/services/streamelements';
export async function GET(request: NextRequest) {
  const origin = getConfiguredAppUrl(request.nextUrl.origin);
  const redirect = (value: string) => { const response = NextResponse.redirect(`${origin}/integrations?${value}`); response.cookies.delete('streamelements_oauth_state'); return response; };
  try {
    const session = getTenantFromRequest(request); if (!session) return redirect('error=streamelements_session');
    const error = request.nextUrl.searchParams.get('error'); if (error) return redirect(`error=streamelements_${encodeURIComponent(error)}`);
    const code = request.nextUrl.searchParams.get('code'); const state = request.nextUrl.searchParams.get('state');
    if (!code || !state || state !== request.cookies.get('streamelements_oauth_state')?.value) return redirect('error=streamelements_state');
    const clientId = process.env.STREAMELEMENTS_CLIENT_ID; const clientSecret = process.env.STREAMELEMENTS_CLIENT_SECRET;
    if (!clientId || !clientSecret) return redirect('error=streamelements_not_configured');
    const redirectUri = process.env.STREAMELEMENTS_REDIRECT_URI || `${origin}/api/auth/streamelements/callback`;
    const tokenResponse = await fetch('https://api.streamelements.com/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }) });
    if (!tokenResponse.ok) return redirect('error=streamelements_token');
    const data = await tokenResponse.json();
    await saveStreamElementsToken({ accessToken: String(data.access_token), refreshToken: data.refresh_token ? String(data.refresh_token) : undefined, expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 604800) - 60) * 1000, scope: String(data.scope || '') }, { tenantId: session.tenantId, username: session.username });
    return redirect('streamelements=connected');
  } catch (error) { console.error('[StreamElements OAuth]', error); return redirect('error=streamelements_callback'); }
}
