import { getChatters } from '@/services/twitch';

/**
 * Calculate similarity score between two strings
 */
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  // Check if shorter string is a subsequence of longer
  let i = 0;
  for (let j = 0; j < longer.length && i < shorter.length; j++) {
    if (shorter[i] === longer[j]) {
      i++;
    }
  }
  
  return i / shorter.length;
}

/**
 * Finds the best matching username from chat based on a partial name
 */
export async function findBestUsernameMatch(partialName: string): Promise<string | null> {
  try {
    const chatters = await getChatters();
    if (!chatters || chatters.length === 0) {
      return null;
    }

    const searchTerm = partialName.toLowerCase();
    
    // Exact match first
    const exactMatch = chatters.find(chatter => 
      chatter.user_login?.toLowerCase() === searchTerm ||
      chatter.user_display_name?.toLowerCase() === searchTerm
    );
    if (exactMatch) {
      return exactMatch.user_login;
    }

    // Starts with match
    const startsWithMatch = chatters.find(chatter =>
      chatter.user_login?.toLowerCase().startsWith(searchTerm) ||
      chatter.user_display_name?.toLowerCase().startsWith(searchTerm)
    );
    if (startsWithMatch) {
      return startsWithMatch.user_login;
    }

    // Contains match
    const containsMatch = chatters.find(chatter =>
      chatter.user_login?.toLowerCase().includes(searchTerm) ||
      chatter.user_display_name?.toLowerCase().includes(searchTerm)
    );
    if (containsMatch) {
      return containsMatch.user_login;
    }

    // Fuzzy match with similarity scoring
    let bestMatch = null;
    let bestScore = 0;
    
    for (const chatter of chatters) {
      const login = chatter.user_login?.toLowerCase() || '';
      const display = chatter.user_display_name?.toLowerCase() || '';
      
      const loginScore = calculateSimilarity(searchTerm, login);
      const displayScore = calculateSimilarity(searchTerm, display);
      const maxScore = Math.max(loginScore, displayScore);
      
      if (maxScore > bestScore && maxScore >= 0.6) {
        bestScore = maxScore;
        bestMatch = chatter.user_login;
      }
    }
    
    return bestMatch;
  } catch (error) {
    console.error('Error finding username match:', error);
    return null;
  }
}