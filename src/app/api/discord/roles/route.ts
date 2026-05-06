import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';

const API = 'https://discord.com/api/v10';

export async function GET(req: NextRequest) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return apiError('DISCORD_BOT_TOKEN not configured', { status: 500, code: 'MISSING_CREDENTIALS' });

  const headers = { Authorization: `Bot ${botToken}` };
  const guildId = req.nextUrl.searchParams.get('guildId');

  // If guildId provided, return roles for that guild
  if (guildId) {
    const res = await fetch(`${API}/guilds/${guildId}/roles`, { headers });
    if (!res.ok) return apiError('Failed to fetch roles', { status: 502, code: 'DISCORD_API_ERROR' });
    const roles = (await res.json() as any[])
      .filter((r: any) => r.name !== '@everyone')
      .sort((a: any, b: any) => b.position - a.position)
      .map((r: any) => ({ id: r.id, name: r.name, color: r.color }));
    return apiOk({ roles });
  }

  // Otherwise return bot's guilds
  const res = await fetch(`${API}/users/@me/guilds`, { headers });
  if (!res.ok) return apiError('Failed to fetch guilds', { status: 502, code: 'DISCORD_API_ERROR' });
  const guilds = (await res.json() as any[]).map((g: any) => ({
    id: g.id,
    name: g.name,
    icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
  }));
  return apiOk({ guilds });
}
