import type { TenantSession } from '@/lib/tenant-context';
import { cleanSaySpeakerForSpeech, cleanSayTextForSpeech } from '@/services/say-tts';

export type SayChatIdentity = {
  username: string;
  avatarUrl?: string;
};

export function resolveSayChatIdentity(session: TenantSession): SayChatIdentity {
  const username = cleanSayTextForSpeech(session.displayName || session.username)
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
  const avatarUrl = String(session.avatar || '').trim();

  return {
    username: username || session.username.slice(0, 80),
    avatarUrl: avatarUrl || undefined,
  };
}

export function buildSayChatSpeech(identity: SayChatIdentity, message: unknown): string {
  const cleanMessage = cleanSayTextForSpeech(message);
  const cleanSpeaker = cleanSaySpeakerForSpeech(identity.username);
  return cleanSpeaker ? `${cleanSpeaker} said: ${cleanMessage}` : cleanMessage;
}
