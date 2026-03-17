const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface Partner {
  id: number;
  name: string;
  discordUserId: string;
  avatarUrl: string;
}

let cachedPartners: Partner[] = [];
let cacheTimestamp = 0;
let cachedKey = '';

async function fetchRoleMembers(guildId: string, roleName: string): Promise<Partner[]> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken || !guildId || !roleName) {
    console.error('[Partner Checkin] Missing DISCORD_BOT_TOKEN, guildId, or roleName');
    return [];
  }

  try {
    const headers = { Authorization: `Bot ${botToken}` };

    const [rolesResp, membersResp] = await Promise.all([
      fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers }),
      fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, { headers }),
    ]);
    if (!rolesResp.ok || !membersResp.ok) return [];

    const roles = (await rolesResp.json()) as any[];
    const role = roles.find((r: any) => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) {
      console.error(`[Partner Checkin] Role "${roleName}" not found in guild ${guildId}`);
      return [];
    }

    const members = (await membersResp.json()) as any[];
    const partners = members
      .filter((m: any) => m.roles?.includes(role.id) && !m.user?.bot)
      .sort((a: any, b: any) => {
        const nameA = (a.nick || a.user?.display_name || a.user?.username || '').toLowerCase();
        const nameB = (b.nick || b.user?.display_name || b.user?.username || '').toLowerCase();
        return nameA.localeCompare(nameB);
      })
      .map((m: any, i: number) => {
        const user = m.user;
        const name = m.nick || user?.display_name || user?.username || 'Unknown';
        const avatarUrl = user?.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`
          : `https://cdn.discordapp.com/embed/avatars/${(parseInt(user?.discriminator || '0') || 0) % 5}.png`;
        return { id: i + 1, name, discordUserId: user?.id || '', avatarUrl };
      });

    console.log(`[Partner Checkin] Loaded ${partners.length} "${roleName}" partners from guild ${guildId}`);
    return partners;
  } catch (err) {
    console.error('[Partner Checkin] Failed to fetch partners:', err);
    return [];
  }
}

async function getPartners(guildId: string, roleName: string): Promise<Partner[]> {
  const key = `${guildId}:${roleName}`;
  if (key === cachedKey && Date.now() - cacheTimestamp < CACHE_TTL && cachedPartners.length > 0) {
    return cachedPartners;
  }
  cachedPartners = await fetchRoleMembers(guildId, roleName);
  cacheTimestamp = Date.now();
  cachedKey = key;
  return cachedPartners;
}

export async function getPartnerById(id: number, guildId: string, roleName: string): Promise<Partner | null> {
  const partners = await getPartners(guildId, roleName);
  return partners.find(p => p.id === id) || null;
}

export async function getAllPartners(guildId: string, roleName: string): Promise<Partner[]> {
  return getPartners(guildId, roleName);
}

export function invalidatePartnerCache(): void {
  cacheTimestamp = 0;
}
