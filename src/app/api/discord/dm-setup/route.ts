import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readDiscordConfig, updateDiscordConfig } from '@/lib/discord-config';
import { createDiscordDmChannel, sendDiscordMessage } from '@/services/discord-local';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

async function sendSetupDm(tenantId: string, discordUserId: string) {
  const dm = await createDiscordDmChannel(discordUserId);
  await updateDiscordConfig({
    discordUserId,
    dmChannelId: dm.id,
    dmEnabled: true,
    dmChannelUpdatedAt: new Date().toISOString(),
  } as any, tenantId);

  await sendDiscordMessage(
    dm.id,
    'StreamWeaver DM setup is connected. This DM channel was created automatically for your tenant; you never need to paste a DM channel ID.',
  );

  return dm.id;
}

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
  const settings = await readDiscordConfig(session.tenantId);
  const existingUserId = String(settings.discordUserId || '').trim();

  if (/^\d{10,32}$/.test(existingUserId)) {
    try {
      await sendSetupDm(session.tenantId, existingUserId);
      return NextResponse.redirect(`${appOrigin}/bot-functions?dmSetup=sent`);
    } catch (error) {
      console.error('[Discord DM Setup] Existing linked user DM failed:', error);
      return NextResponse.redirect(`${appOrigin}/bot-functions?dmSetup=failed`);
    }
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(`${appOrigin}/bot-functions?dmSetup=not_configured`);
  }

  const state = randomBytes(24).toString('base64url');
  const redirectUri = `${appOrigin}/api/discord/dm-setup/callback`;
  const authUrl = new URL('https://discord.com/oauth2/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'identify');
  authUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set('streamweaver-dm-setup-state', state, {
    httpOnly: true,
    secure: appOrigin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
