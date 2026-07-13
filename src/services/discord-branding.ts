import { getBotName } from '@/lib/bot-settings-store';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { getStoredTokens } from '@/lib/token-utils.server';
import { listTenants } from '@/lib/tenant';
import { readUserConfigSync } from '@/lib/user-config';
import { getDiscordMediaPublicPath } from '@/lib/discord-media-store';
import { getTwitchUser } from './twitch';

const STREAMWEAVER_BRAND_NAME = 'StreamWeaver';
const DISCORD_BOT_PROFILE_CACHE_MS = 60 * 60 * 1000;

export type DiscordBotEmbed = {
    description: string;
    thumbnail: { url: string };
    author: {
        name: string;
        icon_url?: string;
        url?: string;
    };
    footer: {
        text: string;
        icon_url: string;
    };
    color: number;
};

const profileImageCache = new Map<string, { url: string; expiresAt: number }>();
const tenantNameCache = new Map<string, { tenantId: string | undefined; expiresAt: number }>();
let discordBotAvatarCache: { url: string; expiresAt: number } | null = null;

function firstUrl(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const text = value.trim();
        if (/^https?:\/\//i.test(text)) return text;
    }
    return '';
}

export function buildBotAvatarUrl(tenantId?: string): string {
    const baseUrl = getConfiguredAppUrl();
    const tenantParam = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
    // Use the same direct GIF endpoint as the TTS player instead of the JS overlay page.
    return `${baseUrl}/api/avatars?type=idle&format=gif${tenantParam}`;
}

type DiscordMediaSlot = 'public' | 'private';

function discordMediaSlotUrl(slot: DiscordMediaSlot): string {
    const fileSlot = slot === 'private' ? 'private-dm' : 'public-discord';
    return `${getConfiguredAppUrl()}${getDiscordMediaPublicPath(fileSlot)}`;
}

function rewriteLegacyLocalDiscordMediaUrl(value: string): string {
    try {
        const url = new URL(value);
        const pathname = url.pathname.toLowerCase();
        if (pathname === '/avatars/private-dm.gif') return `${getConfiguredAppUrl()}${getDiscordMediaPublicPath('private-dm')}`;
        if (pathname === '/avatars/public-discord.gif') return `${getConfiguredAppUrl()}${getDiscordMediaPublicPath('public-discord')}`;
    } catch {
        return '';
    }
    return '';
}

function getConfiguredBotAvatarMediaUrl(tenantId?: string, slot: DiscordMediaSlot = 'public'): string {
    const config = readUserConfigSync(tenantId);
    const slotUrls = slot === 'private'
        ? [config.PRIVATE_DM_GIF_URL, config.PUBLIC_DISCORD_GIF_URL]
        : [config.PUBLIC_DISCORD_GIF_URL, config.PRIVATE_DM_GIF_URL];
    const configured = firstUrl(
        ...slotUrls,
        config.PUBLIC_AVATAR_URL,
        config.TWITCH_BOT_AVATAR_GIF_URL,
        config.TWITCH_BOT_AVATAR_URL,
        config.BOT_AVATAR_URL,
    );
    if (configured) {
        const rewritten = rewriteLegacyLocalDiscordMediaUrl(configured);
        if (rewritten) return rewritten;
    }
    if (configured) return configured;
    if (slot === 'private') return discordMediaSlotUrl(slot);
    return buildBotAvatarUrl(tenantId);
}

export function buildStreamWeaverLogoUrl(): string {
    return `${getConfiguredAppUrl()}/StreamWeaver.png`;
}

export function buildTtsOverlayUrl(tenantId?: string): string {
    const tenantParam = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
    return `${getConfiguredAppUrl()}/tts-player${tenantParam}`;
}

function splitAliases(value: unknown): string[] {
    return String(value || '')
        .toLowerCase()
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean);
}

function normalizeName(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

async function resolveTenantByBotName(botName?: string): Promise<string | undefined> {
    const normalized = normalizeName(botName);
    if (!normalized) return undefined;

    const cached = tenantNameCache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) return cached.tenantId;

    for (const tenantId of await listTenants().catch(() => [])) {
        if (tenantId.startsWith('__kick_silent__')) continue;
        const config = readUserConfigSync(tenantId);
        const names = [
            getBotName(tenantId),
            config.AI_BOT_NAME,
            ...splitAliases(config.AI_BOT_ALIASES),
        ].map(normalizeName).filter(Boolean);

        if (names.includes(normalized)) {
            tenantNameCache.set(normalized, { tenantId, expiresAt: Date.now() + 5 * 60 * 1000 });
            return tenantId;
        }
    }

    tenantNameCache.set(normalized, { tenantId: undefined, expiresAt: Date.now() + 60 * 1000 });
    return undefined;
}

async function getTwitchProfileImage(username: string): Promise<string> {
    const key = normalizeName(username);
    if (!key) return '';
    const cached = profileImageCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    try {
        const user = await getTwitchUser(username);
        const url = user?.profileImageUrl || '';
        profileImageCache.set(key, { url, expiresAt: Date.now() + 60 * 60 * 1000 });
        return url;
    } catch {
        profileImageCache.set(key, { url: '', expiresAt: Date.now() + 5 * 60 * 1000 });
        return '';
    }
}

async function getTenantOwnerBranding(tenantId?: string, botName?: string): Promise<{ name: string; iconUrl?: string }> {
    const resolvedTenantId = tenantId || await resolveTenantByBotName(botName);
    if (!resolvedTenantId) return { name: STREAMWEAVER_BRAND_NAME };

    const tokens = await getStoredTokens(resolvedTenantId).catch(() => null);
    const ownerName = tokens?.broadcasterUsername || tokens?.loginUsername || STREAMWEAVER_BRAND_NAME;
    const ownerIconUrl = firstUrl(
        tokens?.broadcasterAvatarUrl,
        tokens?.broadcasterProfileImageUrl,
        tokens?.loginAvatarUrl,
        tokens?.loginProfileImageUrl
    ) || (ownerName !== STREAMWEAVER_BRAND_NAME ? await getTwitchProfileImage(ownerName) : '');

    return ownerIconUrl
        ? { name: ownerName, iconUrl: ownerIconUrl }
        : { name: ownerName };
}

function formatDeleteCountdown(deleteAt?: string): string {
    const ts = Date.parse(String(deleteAt || ''));
    if (!Number.isFinite(ts)) return '';
    const remainingMs = Math.max(0, ts - Date.now());
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    return `deletes in ${remainingMinutes}m`;
}

export async function getDiscordBotProfileAvatarUrl(): Promise<string> {
    if (discordBotAvatarCache && discordBotAvatarCache.expiresAt > Date.now()) {
        return discordBotAvatarCache.url;
    }

    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) return '';

    try {
        const response = await fetch('https://discord.com/api/v10/users/@me', {
            headers: {
                Authorization: `Bot ${token}`,
            },
            cache: 'no-store',
        });
        if (!response.ok) return '';

        const data = await response.json().catch(() => null) as { id?: string; avatar?: string } | null;
        if (!data?.id || !data.avatar) return '';

        const ext = data.avatar.startsWith('a_') ? 'gif' : 'png';
        const url = `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${ext}?size=256`;
        discordBotAvatarCache = { url, expiresAt: Date.now() + DISCORD_BOT_PROFILE_CACHE_MS };
        return url;
    } catch {
        return '';
    }
}

export async function buildDiscordBotEmbed(input: {
    description: string;
    tenantId?: string;
    botName?: string;
    footerText?: string;
    deleteAt?: string;
    authorUrl?: string;
    authorName?: string;
    authorIconUrl?: string;
    mediaSlot?: DiscordMediaSlot;
}): Promise<DiscordBotEmbed> {
    const resolvedTenantId = input.tenantId || await resolveTenantByBotName(input.botName);
    const owner = await getTenantOwnerBranding(resolvedTenantId, input.botName);
    const defaultBotName = input.botName || getBotName(resolvedTenantId);
    const authorName = input.authorName || defaultBotName || owner.name;
    const authorIconUrl = input.authorIconUrl
        || owner.iconUrl;
    const avatarMediaUrl = getConfiguredBotAvatarMediaUrl(resolvedTenantId, input.mediaSlot) || buildBotAvatarUrl(resolvedTenantId);
    const footerParts = [STREAMWEAVER_BRAND_NAME];
    if (owner.name && owner.name !== STREAMWEAVER_BRAND_NAME) {
        footerParts.push(owner.name);
    }
    const deleteCountdown = formatDeleteCountdown(input.deleteAt);
    if (deleteCountdown) {
        footerParts.push(deleteCountdown);
    }
    return {
        description: input.description,
        thumbnail: { url: avatarMediaUrl },
        author: {
            name: authorName,
            ...(authorIconUrl ? { icon_url: authorIconUrl } : {}),
            url: input.authorUrl || buildTtsOverlayUrl(resolvedTenantId),
        },
        footer: {
            text: input.footerText || footerParts.join(' • '),
            icon_url: buildStreamWeaverLogoUrl(),
        },
        color: 0x5865F2,
    };
}

export function getDiscordBotWebhookIdentity(tenantId?: string, botName?: string) {
    return {
        username: botName || getBotName(tenantId),
        avatarUrl: '',
    };
}

export async function resolveDiscordBotTenantId(botName?: string, tenantId?: string): Promise<string | undefined> {
    return tenantId || await resolveTenantByBotName(botName);
}
