import { getBotName } from '@/lib/bot-settings-store';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { getStoredTokens } from '@/lib/token-utils.server';
import { listTenants } from '@/lib/tenant';
import { readUserConfigSync } from '@/lib/user-config';
import { getDiscordMediaPublicPath } from '@/lib/discord-media-store';
import { getTwitchUser } from './twitch';
import { getDiscordAvatarVersion, hasTenantOwnAvatar } from './discord-avatar-media';

const STREAMWEAVER_BRAND_NAME = 'StreamWeaver';
const DISCORD_BOT_PROFILE_CACHE_MS = 60 * 60 * 1000;

export type DiscordBotEmbed = {
    title: string;
    description: string;
    thumbnail: { url: string };
    image?: { url: string };
    fields?: Array<{
        name: string;
        value: string;
        inline?: boolean;
    }>;
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
    timestamp: string;
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
    const params = new URLSearchParams();
    if (tenantId) params.set('tenant', tenantId);
    params.set('v', getDiscordAvatarVersion(tenantId));
    // Discord's image proxy can flatten large extensionless GIF responses.
    // Give it a compact, versioned media URL that ends in .gif while overlays
    // continue using the original full-resolution animation.
    return `${baseUrl}/api/discord-avatar/idle.gif?${params.toString()}`;
}

type DiscordMediaSlot = 'public' | 'private';

function rewriteLegacyLocalDiscordMediaUrl(value: string, tenantId?: string): string {
    try {
        const url = new URL(value);
        const pathname = url.pathname.toLowerCase();
        if (pathname === '/avatars/private-dm.gif') return `${getConfiguredAppUrl()}${getDiscordMediaPublicPath('private-dm', tenantId)}`;
        if (pathname === '/avatars/public-discord.gif') return `${getConfiguredAppUrl()}${getDiscordMediaPublicPath('public-discord', tenantId)}`;
    } catch {
        return '';
    }
    return '';
}

function getConfiguredDiscordEmbedMediaUrl(tenantId?: string, slot: DiscordMediaSlot = 'public'): string {
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
        const rewritten = rewriteLegacyLocalDiscordMediaUrl(configured, tenantId);
        if (rewritten) return rewritten;
    }
    if (configured) return configured;
    return '';
}

export async function resolveDiscordBotThumbnailUrl(tenantId?: string): Promise<string> {
    if (hasTenantOwnAvatar(tenantId)) return buildBotAvatarUrl(tenantId);

    const config = readUserConfigSync(tenantId);
    const tokens = (await getStoredTokens(tenantId).catch(() => null)) as Record<string, unknown> | null;
    const configured = firstUrl(
        tokens?.botAvatarUrl,
        tokens?.botProfileImageUrl,
        config.TWITCH_BOT_AVATAR_GIF_URL,
        config.TWITCH_BOT_AVATAR_URL,
        config.BOT_AVATAR_URL,
    );
    return configured || await getDiscordBotProfileAvatarUrl() || buildStreamWeaverLogoUrl();
}

export function buildDiscordUserAvatarUrl(userId?: string, avatarHash?: unknown): string {
    const id = String(userId || '').trim();
    const hash = String(avatarHash || '').trim();
    if (!id || !hash) return '';
    return `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=128`;
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

function truncateDiscordText(value: string, limit: number): string {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function inferResponseType(sourceMessage?: string): string {
    const source = String(sourceMessage || '').trim();
    if (!source.startsWith('!')) return 'AI Answer';

    const command = source.slice(1).split(/\s+/)[0]?.toLowerCase() || '';
    const knownTitles: Record<string, string> = {
        ask: 'AI Answer',
        ai: 'AI Answer',
        img: 'Image Generated',
        image: 'Image Generated',
        say: 'TTS Request',
        status: 'Channel Status',
        help: 'Command Help',
        commands: 'Command Help',
        shoutout: 'Shoutout Created',
        so: 'Shoutout Created',
    };
    return knownTitles[command] || 'Command Response';
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
    title?: string;
    responseType?: string;
    sourceMessage?: string;
    sourceUser?: string;
    sourceUserAvatarUrl?: string;
    footerText?: string;
    deleteAt?: string;
    authorUrl?: string;
    mediaSlot?: DiscordMediaSlot;
    includeConfiguredMedia?: boolean;
    imageUrl?: string;
    thumbnailUrl?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
}): Promise<DiscordBotEmbed> {
    const resolvedTenantId = input.tenantId || await resolveTenantByBotName(input.botName);
    const owner = await getTenantOwnerBranding(resolvedTenantId, input.botName);
    const defaultBotName = input.botName || getBotName(resolvedTenantId);
    const avatarMediaUrl = await resolveDiscordBotThumbnailUrl(resolvedTenantId);
    const configuredMediaUrl = input.includeConfiguredMedia
        ? getConfiguredDiscordEmbedMediaUrl(resolvedTenantId, input.mediaSlot)
        : '';
    const embedMediaUrl = firstUrl(input.imageUrl, configuredMediaUrl);
    const responseType = input.responseType || inferResponseType(input.sourceMessage);
    const title = truncateDiscordText(
        input.title || `${defaultBotName || owner.name || STREAMWEAVER_BRAND_NAME} • ${responseType}`,
        256,
    );
    const footerParts: string[] = [];
    if (input.sourceUser) {
        footerParts.push(`Requested by ${truncateDiscordText(input.sourceUser, 80)}`);
    } else {
        footerParts.push(STREAMWEAVER_BRAND_NAME);
    }
    if (input.sourceMessage) {
        footerParts.push(truncateDiscordText(input.sourceMessage, 240));
    }
    const deleteCountdown = formatDeleteCountdown(input.deleteAt);
    if (deleteCountdown) {
        footerParts.push(deleteCountdown);
    }
    const isAiAnswer = responseType.toLowerCase() === 'ai answer';
    const question = isAiAnswer && input.sourceMessage
        ? truncateDiscordText(input.sourceMessage, 1024)
        : '';
    const fields = [
        ...(question ? [{ name: 'Question', value: question, inline: false }] : []),
        ...(input.fields || []).map((field) => ({
            name: truncateDiscordText(field.name, 256),
            value: truncateDiscordText(field.value, 1024),
            inline: field.inline,
        })),
    ].slice(0, 25);
    return {
        title,
        description: input.description,
        thumbnail: { url: firstUrl(input.thumbnailUrl) || avatarMediaUrl },
        ...(embedMediaUrl ? { image: { url: embedMediaUrl } } : {}),
        ...(fields.length ? { fields } : {}),
        author: {
            name: defaultBotName || owner.name || STREAMWEAVER_BRAND_NAME,
            icon_url: avatarMediaUrl,
            ...(input.authorUrl ? { url: input.authorUrl } : {}),
        },
        footer: {
            text: input.footerText || footerParts.join(' • '),
            icon_url: firstUrl(input.sourceUserAvatarUrl) || avatarMediaUrl,
        },
        color: input.color ?? 0x5865F2,
        timestamp: new Date().toISOString(),
    };
}

export function getDiscordBotWebhookIdentity(tenantId?: string, botName?: string) {
    return {
        username: botName || getBotName(tenantId) || STREAMWEAVER_BRAND_NAME,
        avatarUrl: hasTenantOwnAvatar(tenantId) ? buildBotAvatarUrl(tenantId) : '',
    };
}

export async function resolveDiscordBotTenantId(botName?: string, tenantId?: string): Promise<string | undefined> {
    return tenantId || await resolveTenantByBotName(botName);
}
