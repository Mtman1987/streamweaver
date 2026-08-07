import { NextRequest } from 'next/server';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export type SpmtDiscordIdentity = {
  discordUserId: string;
  discordUsername: string;
};

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

export async function getSpmtDiscordIdentity(request: NextRequest): Promise<SpmtDiscordIdentity | null> {
  const accessToken = String(request.cookies.get('streamweaver-spmt-token')?.value || '').trim();
  if (!accessToken) return null;

  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!response.ok) return null;

  const user = await response.json().catch(() => null) as any;
  const discord = user?.discord || user?.identities?.discord || {};
  const discordUserId = firstString(
    user?.discordUserId,
    user?.discord_user_id,
    user?.discordId,
    user?.discord_id,
    discord?.userId,
    discord?.user_id,
    discord?.id,
  );
  if (!/^\d{10,32}$/.test(discordUserId)) return null;

  return {
    discordUserId,
    discordUsername: firstString(
      user?.discordUsername,
      user?.discord_username,
      discord?.displayName,
      discord?.display_name,
      discord?.username,
    ),
  };
}
