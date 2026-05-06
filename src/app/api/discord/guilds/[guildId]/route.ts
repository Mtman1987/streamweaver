import { NextRequest, NextResponse } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

export async function GET(request: NextRequest, { params }: { params: { guildId: string } }) {
  try {
    const guildId = params.guildId;
    if (!guildId) return apiError('guildId required', { status: 400, code: 'MISSING_GUILD_ID' });

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) return apiError('DISCORD_BOT_TOKEN not configured', { status: 500, code: 'MISSING_CREDENTIALS' });

    const url = (path: string) => `${DISCORD_API_BASE}${path}`;

    // membersLimit query param (default 100)
    const qp = Object.fromEntries(request.nextUrl.searchParams.entries());
    const membersLimit = Math.min(parseInt(qp.membersLimit || '100', 10) || 100, 1000);

    const headers = {
      Authorization: `Bot ${botToken}`,
      'User-Agent': 'StreamWeaver-Bot (1.0)'
    } as Record<string,string>;

    // Fetch channels
    const [channelsRes, rolesRes, membersRes] = await Promise.all([
      fetch(url(`/guilds/${guildId}/channels`), { headers }),
      fetch(url(`/guilds/${guildId}/roles`), { headers }),
      fetch(url(`/guilds/${guildId}/members?limit=${membersLimit}`), { headers }),
    ]);

    if (!channelsRes.ok) {
      const txt = await channelsRes.text().catch(() => '');
      return apiError(`Failed to fetch channels: ${channelsRes.status} ${txt}`, { status: 502, code: 'DISCORD_CHANNELS_FETCH_FAILED' });
    }
    if (!rolesRes.ok) {
      const txt = await rolesRes.text().catch(() => '');
      return apiError(`Failed to fetch roles: ${rolesRes.status} ${txt}`, { status: 502, code: 'DISCORD_ROLES_FETCH_FAILED' });
    }

    const channels = await channelsRes.json();
    const roles = await rolesRes.json();

    let members: any[] = [];
    if (membersRes.ok) {
      members = await membersRes.json();
    } else {
      // Members may be restricted by intents; return empty array and surface a message
      const txt = await membersRes.text().catch(() => '');
      console.warn('[Discord] guild members fetch failed:', membersRes.status, txt);
    }

    return apiOk({ guildId, channels, roles, members, membersLimit });
  } catch (error: any) {
    console.error('Error in /api/discord/guilds/[guildId]:', error);
    return apiError(error?.message || String(error), { status: 500, code: 'INTERNAL_ERROR' });
  }
}
