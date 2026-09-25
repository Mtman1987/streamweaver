import type { AvatarGestureName } from '@/lib/avatar-gestures';
import { rememberAvatarGesture } from '@/lib/avatar-gesture-runtime';

const RECOVERY_MS: Partial<Record<AvatarGestureName, number>> = {
  dance_gesture: 9_000,
  spin_gesture: 4_500,
  applaud_gesture: 5_000,
  wave_gesture: 3_000,
  look_gesture: 4_000,
  happy_gesture: 3_500,
  laugh_gesture: 3_500,
  playful_tilt_gesture: 3_500,
  blow_kiss_gesture: 3_500,
};

const lastPhysicalAction = new Map<string, { gesture: AvatarGestureName; at: number }>();

export function stageStellaPhysicalReaction(tenantId: string, text: string, gesture?: AvatarGestureName, now = Date.now()) {
  if (!gesture) return { staged: false, recoveryMs: 0 };
  const prior = lastPhysicalAction.get(tenantId);
  const recoveryMs = RECOVERY_MS[gesture] || 3_500;

  // Repeated generated gestures in a few seconds look like animation jitter.
  // Let speech continue but suppress the duplicate body action.
  if (prior?.gesture === gesture && now - prior.at < Math.min(3_000, recoveryMs)) {
    return { staged: false, recoveryMs };
  }

  rememberAvatarGesture(tenantId, text, gesture);
  lastPhysicalAction.set(tenantId, { gesture, at: now });
  return { staged: true, recoveryMs };
}

export function resetStellaPhysicalDirector() {
  lastPhysicalAction.clear();
}
