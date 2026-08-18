import { getSpmtEasterEggEntitlement } from './spmt-easter-eggs';

export const VOIDWALKER_TITLE = 'Voidwalker' as const;

export async function isVoidwalker(input: {
  context: string;
  providerUserId?: string | null;
}): Promise<boolean> {
  const providerUserId = String(input.providerUserId || '').trim();
  if (!providerUserId) return false;

  const context = String(input.context || '').toLowerCase();
  const provider = context.startsWith('discord')
    ? 'discord'
    : context.startsWith('twitch')
      ? 'twitch'
      : null;
  if (!provider) return false;

  const entitlement = await getSpmtEasterEggEntitlement({ provider, providerUserId });
  return entitlement.title === VOIDWALKER_TITLE;
}

export function getVoidwalkerSystemPrompt(): string {
  return `IMPORTANT IDENTITY NOTE: This user has earned the ecosystem-wide title \"${VOIDWALKER_TITLE}\" by completing all three hidden Space Mountain anomalies. You may naturally recognize or address them as \"${VOIDWALKER_TITLE}\" when it fits your personality. Treat the title as a real shared identity fact across bots, not a role they can edit or claim manually. Do not explain the hidden unlock requirements or reveal Easter egg solutions.`;
}
