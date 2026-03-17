import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface UserTokens {
  broadcasterToken?: string;
  botToken?: string;
  broadcasterRefreshToken?: string;
  botRefreshToken?: string;
  broadcasterUsername?: string;
  botUsername?: string;
  twitchClientId?: string;
  twitchClientSecret?: string;
  // Optional: Store token expiry times for better validation
  broadcasterTokenExpiry?: number;
  botTokenExpiry?: number;
}

/**
 * Stores user tokens in Firestore
 */
export async function storeUserTokens(userId: string, tokens: Partial<UserTokens>): Promise<void> {
  try {
    const userDocRef = doc(db, "users", userId);
    await setDoc(userDocRef, { tokens }, { merge: true });
    console.log(`Stored tokens for user ${userId}`);
  } catch (error) {
    console.error("Error storing user tokens:", error);
    throw error;
  }
}

/**
 * Retrieves user tokens from Firestore
 */
export async function getUserTokens(userId: string): Promise<UserTokens | null> {
  try {
    const userDocRef = doc(db, "users", userId);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
      const data = userDoc.data();
      return data.tokens as UserTokens || null;
    }

    return null;
  } catch (error) {
    console.error("Error retrieving user tokens:", error);
    throw error;
  }
}
