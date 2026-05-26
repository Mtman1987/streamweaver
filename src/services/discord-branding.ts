import { getBotName } from '@/lib/bot-settings-store';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { getStoredTokens } from '@/lib/token-utils.server';

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

function buildBotAvatarUrl(tenantId?: string): string {
    const baseUrl = getConfiguredAppUrl();
    const tenantParam = tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : '';
    const cacheVersion = Math.floor(Date.now() / 3_600_000);
    return `${baseUrl}/api/avatars?type=idle&format=gif${tenantParam}&v=${cacheVersion}`;
}

function buildStreamWeaverLogoUrl(): string {
    return `${getConfiguredAppUrl()}/StreamWeaver.png`;
}

async function getTenantOwnerBranding(tenantId?: string): Promise<{ name: string; iconUrl?: string }> {
    if (!tenantId) return { name: STREAMWEAVER_BRAND_NAME };

    const tokens = await getStoredTokens(tenantId).catch(() => null);
    const ownerName = tokens?.broadcasterUsername || tokens?.loginUsername || STREAMWEAVER_BRAND_NAME;
    const ownerIconUrl = tokens?.broadcasterProfileImageUrl || tokens?.loginProfileImageUrl || (
        ownerName !== STREAMWEAVER_BRAND_NAME
            ? `https://static-cdn.jtvnw.net/jtv_user_pictures/${ownerName.toLowerCase()}-profile_image-300x300.png`
            : ''
    );

    return ownerIconUrl
        ? { name: ownerName, iconUrl: ownerIconUrl }
        : { name: ownerName };
}

export async function buildDiscordBotEmbed(input: {
    description: string;
    tenantId?: string;
    footerText?: string;
    authorUrl?: string;
    authorName?: string;
}): Promise<DiscordBotEmbed> {
    const owner = await getTenantOwnerBranding(input.tenantId);
    return {
        description: input.description,
        thumbnail: { url: buildBotAvatarUrl(input.tenantId) },
        author: {
            name: input.authorName || owner.name,
            ...(owner.iconUrl ? { icon_url: owner.iconUrl } : {}),
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
