import { getChatters } from './twitch';
import { handleWalkOnShoutout } from './walk-on-shoutout';
import { matchShoutoutTarget } from './shoutout-matcher';

// ============================
// MAIN EXECUTION
// ============================

export async function handleVoiceShoutout(spokenName: string, tenantId?: string): Promise<void> {
    console.log(`[VoiceShoutout] Processing voice shoutout for: "${spokenName}"`);
    
    // Get current chatters for this tenant
    const chattersData = await getChatters(tenantId);
    const chatters = chattersData.map(c => c.user_login.toLowerCase());
    
    if (chatters.length === 0) {
        console.log('[VoiceShoutout] No chatters found');
        return;
    }
    
    const matchedUsername = await matchShoutoutTarget(spokenName, chatters, tenantId);
    
    if (!matchedUsername) {
        console.log(`[VoiceShoutout] Matching failed for "${spokenName}"`);
        return;
    }
    
    console.log(`[VoiceShoutout] Matched "${spokenName}" to ${matchedUsername}`);
    
    // Find full chatter data
    const chatter = chattersData.find(c => c.user_login.toLowerCase() === matchedUsername);
    
    if (!chatter) {
        console.log(`[VoiceShoutout] Chatter data not found for ${matchedUsername}`);
        return;
    }
    
    // Trigger walk-on shoutout flow
    const displayName = chatter.user_display_name || chatter.user_login || matchedUsername;
    const profileImage = `https://static-cdn.jtvnw.net/jtv_user_pictures/${matchedUsername}-profile_image-300x300.png`;
    await handleWalkOnShoutout(matchedUsername, displayName, profileImage, true, tenantId);
}

