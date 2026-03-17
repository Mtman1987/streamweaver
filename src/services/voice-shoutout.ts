import { getChatters } from './twitch';
import { handleWalkOnShoutout } from './walk-on-shoutout';

// ============================
// AI USERNAME MATCHING
// ============================

async function matchUsernameWithAI(spokenName: string, chatters: string[]): Promise<string | null> {
    const apiKey = process.env.EDENAI_API_KEY;
    
    if (!apiKey || chatters.length === 0) {
        return null;
    }

    const prompt = `You are a username matcher. Someone said "${spokenName}" via voice command.
    
Here are the current chatters:
${chatters.join(', ')}

Which username is the CLOSEST match? You MUST pick one - even if it's not perfect.
Consider:
- Similar sounds ("tiger flakes" = "tigerflakes420")
- Partial matches ("em tee" = "mtman1987")
- Phonetic similarities

Respond with ONLY the exact username from the list that is closest, nothing else.`;

    try {
        const response = await fetch('https://api.edenai.run/v2/text/chat', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                providers: 'openai',
                text: prompt,
                chatbot_global_action: 'You are a username matcher. Respond with ONLY the exact username, nothing else.',
                temperature: 0.3,
                max_tokens: 50,
            }),
        });

        const data = await response.json();
        const match = data.openai?.generated_text?.trim().toLowerCase();
        
        if (!match) {
            console.warn('[VoiceShoutout] AI returned empty match');
            return chatters[0];
        }
        
        // Verify the match is actually in the chatters list
        if (chatters.includes(match)) {
            return match;
        }
        
        // If AI returned something not in list, pick first chatter as fallback
        console.log(`[VoiceShoutout] AI returned invalid match: "${match}", using first chatter`);
        return chatters[0];
    } catch (error) {
        console.error('[VoiceShoutout] AI matching failed:', error);
        return chatters[0];
    }
}

// ============================
// MAIN EXECUTION
// ============================

export async function handleVoiceShoutout(spokenName: string): Promise<void> {
    console.log(`[VoiceShoutout] Processing voice shoutout for: "${spokenName}"`);
    
    // Get current chatters
    const chattersData = await getChatters();
    const chatters = chattersData.map(c => c.user_login.toLowerCase());
    
    if (chatters.length === 0) {
        console.log('[VoiceShoutout] No chatters found');
        return;
    }
    
    // Ask AI to match - ALWAYS returns closest match
    const matchedUsername = await matchUsernameWithAI(spokenName, chatters);
    
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
    const displayName = chatter.user_name || chatter.user_login || matchedUsername;
    const profileImage = `https://static-cdn.jtvnw.net/jtv_user_pictures/${matchedUsername}-profile_image-300x300.png`;
    await handleWalkOnShoutout(matchedUsername, displayName, profileImage, true);
}
