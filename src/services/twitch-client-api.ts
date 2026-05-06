/**
 * Browser-safe Twitch helpers that call existing API routes.
 */

export async function createTwitchClip(): Promise<{ id: string; edit_url: string } | null> {
  try {
    const response = await fetch('/api/twitch/create-clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.warn('Failed to create clip');
      return null;
    }

    const data = await response.json();
    return data.clip || null;
  } catch (error) {
    console.warn('Error creating Twitch clip:', error);
    return null;
  }
}
