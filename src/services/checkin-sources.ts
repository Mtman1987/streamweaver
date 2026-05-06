import { getAllPartners } from './partner-checkin';
import { getPartnerInviteLink } from './checkin-stats';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';
import { getConfigSection } from '../lib/local-config/service';

export type CheckinKind = 'partner' | 'crew' | 'mod' | 'space-mountain';

export interface CheckinEntry {
  id: number;
  key: string;
  name: string;
  imageUrl: string;
  inviteLink?: string;
  discordUserId?: string;
  twitchUserId?: string;
}

export interface CheckinSourceResult {
  kind: CheckinKind;
  label: string;
  sourceLabel: string;
  selectionMode: 'pick' | 'bulk';
  entries: CheckinEntry[];
  error?: string;
}

async function getBroadcasterAuth(tenantId?: string): Promise<{ clientId: string; accessToken: string; broadcasterId: string; broadcasterUsername: string } | null> {
  try {
    const tokens = await getStoredTokens(tenantId);
    if (!tokens) return null;

    const twitchConfig = await getConfigSection('twitch', tenantId);
    const clientId = tokens.twitchClientId || twitchConfig.clientId || process.env.TWITCH_CLIENT_ID;
    const clientSecret = twitchConfig.clientSecret || process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const accessToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);
    const validate = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!validate.ok) return null;

    const data = await validate.json() as any;
    const broadcasterId = String(data?.user_id || '');
    if (!broadcasterId) return null;

    return {
      clientId,
      accessToken,
      broadcasterId,
      broadcasterUsername: tokens.broadcasterUsername || tokens.loginUsername || '',
    };
  } catch (err) {
    console.warn('[CheckinSources] getBroadcasterAuth failed:', err);
    return null;
  }
}

function sortAndAssignIds(entries: Omit<CheckinEntry, 'id'>[]): CheckinEntry[] {
  return [...entries]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((entry, index) => ({ ...entry, id: index + 1 }));
}

function toEntryKey(kind: CheckinKind, rawId: string, fallbackName: string): string {
  const normalizedId = rawId.trim();
  if (normalizedId) return `${kind}:${normalizedId}`;
  return `${kind}:name:${fallbackName.trim().toLowerCase()}`;
}

function coerceArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.crew)) return payload.crew;
  if (Array.isArray(payload?.members)) return payload.members;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function fetchPartnerSource(tenantId?: string): Promise<CheckinSourceResult> {
  const redeemsConfig = await getConfigSection('redeems', tenantId);
  const guildId = redeemsConfig.partnerCheckin.discordGuildId;
  const roleName = redeemsConfig.partnerCheckin.discordRoleName;
  if (!guildId || !roleName) {
    return { kind: 'partner', label: 'Partner Check-In', sourceLabel: 'Partners', selectionMode: 'pick', entries: [] };
  }

  const partners = await getAllPartners(guildId, roleName);
  const entries = sortAndAssignIds(partners.map((partner) => ({
    key: toEntryKey('partner', partner.discordUserId, partner.name),
    name: partner.name,
    imageUrl: partner.avatarUrl,
    inviteLink: getPartnerInviteLink(partner.discordUserId, tenantId),
    discordUserId: partner.discordUserId,
  })));

  return {
    kind: 'partner',
    label: 'Partner Check-In',
    sourceLabel: 'Partners',
    selectionMode: 'pick',
    entries,
  };
}

async function fetchCrewSource(tenantId?: string): Promise<CheckinSourceResult> {
  const redeemsConfig = await getConfigSection('redeems', tenantId);
  const apiUrl = String(redeemsConfig.crewCheckin?.apiUrl || '').trim();
  if (!apiUrl) {
    return { kind: 'crew', label: 'Crew Check-In', sourceLabel: 'Crew', selectionMode: 'pick', entries: [] };
  }

  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      console.warn('[Crew Checkin] Failed to fetch crew source:', response.status, await response.text().catch(() => ''));
      return { kind: 'crew', label: 'Crew Check-In', sourceLabel: 'Crew', selectionMode: 'pick', entries: [] };
    }

    const payload = await response.json().catch(() => null);
    const members = coerceArray(payload);
    const entries = sortAndAssignIds(members
      .map((member: any) => {
        const name = String(
          member?.name ||
          member?.display_name ||
          member?.displayName ||
          member?.username ||
          member?.login ||
          ''
        ).trim();
        if (!name) return null;
        const rawId = String(member?.id || member?.user_id || member?.discord_id || member?.twitch_id || name);
        return {
          key: toEntryKey('crew', rawId, name),
          name,
          imageUrl: String(member?.imageUrl || member?.avatarUrl || member?.avatar || member?.profile_image_url || ''),
          inviteLink: String(member?.inviteLink || member?.discordInvite || ''),
          discordUserId: String(member?.discordUserId || member?.discord_id || ''),
          twitchUserId: String(member?.twitchUserId || member?.twitch_id || ''),
        };
      })
      .filter(Boolean) as Omit<CheckinEntry, 'id'>[]);

    return {
      kind: 'crew',
      label: 'Crew Check-In',
      sourceLabel: 'Crew',
      selectionMode: 'pick',
      entries,
    };
  } catch (error) {
    console.warn('[Crew Checkin] Source fetch failed:', error);
    return { kind: 'crew', label: 'Crew Check-In', sourceLabel: 'Crew', selectionMode: 'pick', entries: [] };
  }
}

async function fetchModSource(tenantId?: string): Promise<CheckinSourceResult> {
  const auth = await getBroadcasterAuth(tenantId);
  if (!auth) {
    return { kind: 'mod', label: 'Mod Check-In', sourceLabel: 'Mods', selectionMode: 'pick', entries: [], error: 'No broadcaster auth available. Re-auth as Broadcaster on the Integrations page.' };
  }

  try {
    const moderatorsResponse = await fetch(
      `https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${encodeURIComponent(auth.broadcasterId)}&first=100`,
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Client-ID': auth.clientId,
        },
      }
    );
    if (!moderatorsResponse.ok) {
      const errText = await moderatorsResponse.text().catch(() => '');
      console.warn('[Mod Checkin] Failed to fetch moderators:', moderatorsResponse.status, errText);
      const hint = moderatorsResponse.status === 401 || moderatorsResponse.status === 403
        ? `Twitch returned ${moderatorsResponse.status}. Re-auth as Broadcaster with the moderator scope.`
        : `Twitch API error ${moderatorsResponse.status}: ${errText.slice(0, 120)}`;
      return { kind: 'mod', label: 'Mod Check-In', sourceLabel: 'Mods', selectionMode: 'pick', entries: [], error: hint };
    }

    const moderatorsPayload = await moderatorsResponse.json() as any;
    const moderators = Array.isArray(moderatorsPayload?.data) ? moderatorsPayload.data : [];
    const ids = moderators.map((mod: any) => String(mod?.user_id || '')).filter(Boolean);

    const profileMap = new Map<string, string>();
    if (ids.length > 0) {
      const params = ids.map((id: string) => `id=${encodeURIComponent(id)}`).join('&');
      const usersResponse = await fetch(`https://api.twitch.tv/helix/users?${params}`, {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Client-ID': auth.clientId,
        },
      });
      if (usersResponse.ok) {
        const usersPayload = await usersResponse.json() as any;
        for (const user of usersPayload?.data || []) {
          profileMap.set(String(user?.id || ''), String(user?.profile_image_url || ''));
        }
      }
    }

    const entries = sortAndAssignIds(moderators.map((mod: any) => ({
      key: toEntryKey('mod', String(mod?.user_id || ''), String(mod?.user_name || mod?.user_login || '')),
      name: String(mod?.user_name || mod?.user_login || '').trim(),
      imageUrl: profileMap.get(String(mod?.user_id || '')) || '',
      twitchUserId: String(mod?.user_id || ''),
    })).filter((entry: Omit<CheckinEntry, 'id'>) => entry.name));

    return {
      kind: 'mod',
      label: 'Mod Check-In',
      sourceLabel: 'Mods',
      selectionMode: 'pick',
      entries,
    };
  } catch (error: any) {
    console.warn('[Mod Checkin] Source fetch failed:', error);
    return { kind: 'mod', label: 'Mod Check-In', sourceLabel: 'Mods', selectionMode: 'pick', entries: [], error: error?.message || 'Unknown error fetching mods' };
  }
}

async function fetchSpaceMountainSource(tenantId?: string, actorUsername?: string): Promise<CheckinSourceResult> {
  const auth = await getBroadcasterAuth(tenantId);
  if (!auth) {
    return { kind: 'space-mountain', label: 'Space Mountain Check-In', sourceLabel: 'Space Mountain Riders', selectionMode: 'bulk', entries: [] };
  }

  try {
    const response = await fetch(
      `https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${encodeURIComponent(auth.broadcasterId)}&moderator_id=${encodeURIComponent(auth.broadcasterId)}&first=1000`,
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Client-ID': auth.clientId,
        },
      }
    );
    if (!response.ok) {
      console.warn('[Space Mountain] Failed to fetch chatters:', response.status, await response.text().catch(() => ''));
      return { kind: 'space-mountain', label: 'Space Mountain Check-In', sourceLabel: 'Space Mountain Riders', selectionMode: 'bulk', entries: [] };
    }

    const payload = await response.json() as any;
    const actor = (actorUsername || '').toLowerCase();
    const broadcaster = (auth.broadcasterUsername || '').toLowerCase();
    const entries = sortAndAssignIds((payload?.data || [])
      .map((chatter: any) => {
        const login = String(chatter?.user_login || '').trim();
        const name = String(chatter?.user_name || login).trim();
        if (!login || login.toLowerCase() === actor || login.toLowerCase() === broadcaster) return null;
        return {
          key: toEntryKey('space-mountain', String(chatter?.user_id || login), name),
          name,
          imageUrl: '',
          twitchUserId: String(chatter?.user_id || ''),
        };
      })
      .filter(Boolean) as Omit<CheckinEntry, 'id'>[]);

    return {
      kind: 'space-mountain',
      label: 'Space Mountain Check-In',
      sourceLabel: 'Space Mountain Riders',
      selectionMode: 'bulk',
      entries,
    };
  } catch (error) {
    console.warn('[Space Mountain] Source fetch failed:', error);
    return { kind: 'space-mountain', label: 'Space Mountain Check-In', sourceLabel: 'Space Mountain Riders', selectionMode: 'bulk', entries: [] };
  }
}

export async function getCheckinSource(kind: CheckinKind, tenantId?: string, actorUsername?: string): Promise<CheckinSourceResult> {
  switch (kind) {
    case 'partner':
      return fetchPartnerSource(tenantId);
    case 'crew':
      return fetchCrewSource(tenantId);
    case 'mod':
      return fetchModSource(tenantId);
    case 'space-mountain':
      return fetchSpaceMountainSource(tenantId, actorUsername);
    default:
      return { kind, label: 'Check-In', sourceLabel: 'Check-In', selectionMode: 'pick', entries: [] };
  }
}
