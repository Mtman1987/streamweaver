import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { updateDiscordConfig } from '@/lib/discord-config';
import { createDiscordDmChannel, sendDiscordMessage } from '@/services/discord-local';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
  if (!session?.tenantId) return NextResponse.redirect(`${appOrigin}/login`);

  const code = request.nextUrl.searchParams.get('code') || '';
  const state = request.nextUrl.searchParams.get('state') || '';
  const expectedState = request.cookies.get('streamweaver-dm-setup-state')?.value || '';
  if (!code || !state || !expectedState || !safeEqual(state, expectedState)) {
    return NextResponse.redirect(`${appOrigin}/bot-functions?dmSetup=invalid_state`);
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appOrigin}/bot-functions?dmSetup=not_configured`);
  }

  const redirectUri = `${appOrigin}/api/discord/dm-setup/callback`;
  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error('Discord token exchange failed');

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });
    const user = await userResponse.json().catch(() => ({}));
    const discordUserId = String(user.id || '').trim();
    if (!userResponse.ok || !/^\d{10,32}$/.test(discordUserId)) throw new Error('Discord user lookup failed');

    const dm = await createDiscordDmChannel(discordUserId);
    await updateDiscordConfig({
      discordUserId,
      discordUsername: String(user.username || ''),
      discordUserLinkedAt: new Date().toISOString(),
      dmChannelId: dm.id,
      dmEnabled: true,
      dmChannelUpdatedAt: new Date().toISOString(),
    } as any, session.tenantId);

    await sendDiscordMessage(
      dm.id,
      'StreamWeaver DM setup is connected. Your private bot DM is ready, and StreamWeaver saved the DM channel automatically.',
    );

    const response = NextResponse.redirect(`${appOrigin}/bot-functions?dmSetup=sent`);
    response.cookies.delete('streamweaver-dm-setup-state');
    return response;
  } catch (error) {
    console.error('[Discord DM Setup] Callback failed:', error);
    const response = NextResponse.redirect(`${appOrigin}/bot-functions?dmSetup=failed`);
    response.cookies.delete('streamweaver-dm-setup-state');
    return response;
  }
}
