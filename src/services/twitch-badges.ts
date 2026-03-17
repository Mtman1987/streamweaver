import { getTwitchUser, getChannelBadges } from './twitch';

type TwitchBadgeVersion = {
    id: string;
    image_url_1x: string;
    image_url_2x: string;
    image_url_4x: string;
};

type TwitchBadgeSet = Record<string, TwitchBadgeVersion>;
type TwitchBadges = Record<string, TwitchBadgeSet>;

let channelBadges: TwitchBadges = {};

export async function initializeBadges() {
    const broadcasterId = process.env.NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID;
    if (!broadcasterId) {
        console.error('[Twitch] NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID not set. Retrying in 5 seconds...');
        setTimeout(initializeBadges, 5000);
        return;
    }
    
    try {
        console.log(`[Twitch] Fetching user data for broadcaster: ${broadcasterId}`);
        const user = await getTwitchUser(broadcasterId, "id");
        
        if (user?.id) {
            console.log(`[Twitch] Broadcaster ID: ${user.id}`);
            const globalBadges = await getChannelBadges();
            const specificBadges = await getChannelBadges(user.id);
            channelBadges = { ...globalBadges, ...specificBadges };
            console.log('[Twitch] Successfully fetched and cached channel badges');
        } else {
            console.error('[Twitch] Could not fetch user ID for broadcaster');
        }
    } catch (error) {
        console.error('[Twitch] Failed to initialize channel badges:', error);
    }
}

export function getChannelBadgesCache(): TwitchBadges {
    return channelBadges;
}