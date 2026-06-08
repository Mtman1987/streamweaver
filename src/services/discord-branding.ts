import { getBotName } from '@/lib/bot-settings-store';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { getStoredTokens } from '@/lib/token-utils.server';
import { listTenants } from '@/lib/tenant';
import { readUserConfigSync } from '@/lib/user-config';
import { getTwitchUser } from './twitch';

const STREAMWEAVER_BRAND_NAME = 'StreamWeaver';

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
    const tenantParam = tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : '';
    const cacheVersion = Math.floor(Date.now() / 3_600_000);
    return `${baseUrl}/api/avatars?type=idle&format=gif${tenantParam}&v=${cacheVersion}`;
}

export function buildStreamWeaverLogoUrl(): string {
    return `${getConfiguredAppUrl()}/StreamWeaver.png`;
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

export async function buildDiscordBotEmbed(input: {
    description: string;
    tenantId?: string;
    botName?: string;
    footerText?: string;
    authorUrl?: string;
    authorName?: string;
    authorIconUrl?: string;
}): Promise<DiscordBotEmbed> {
    const resolvedTenantId = input.tenantId || await resolveTenantByBotName(input.botName);
    const owner = await getTenantOwnerBranding(resolvedTenantId, input.botName);
    const defaultBotName = input.botName || getBotName(resolvedTenantId);
    const authorName = input.authorName || defaultBotName || owner.name;
    const authorIconUrl = input.authorIconUrl
        || (input.authorName ? owner.iconUrl : buildBotAvatarUrl(resolvedTenantId));
    return {
        description: input.description,
        thumbnail: { url: buildBotAvatarUrl(resolvedTenantId) },
        author: {
            name: authorName,
            ...(authorIconUrl ? { icon_url: authorIconUrl } : {}),
            ...(input.authorUrl ? { url: input.authorUrl } : {}),
        },
        footer: {
            text: input.footerText || STREAMWEAVER_BRAND_NAME,
            icon_url: buildStreamWeaverLogoUrl(),
        },
        color: 0x5865F2,
    };
}

export function getDiscordBotWebhookIdentity(tenantId?: string, botName?: string) {
    return {
        username: botName || getBotName(tenantId),
        avatarUrl: undefined,
    };
}

export async function resolveDiscordBotTenantId(botName?: string, tenantId?: string): Promise<string | undefined> {
    return tenantId || await resolveTenantByBotName(botName);
}
