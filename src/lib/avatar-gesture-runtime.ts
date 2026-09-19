import type { AvatarGestureName } from './avatar-gestures';

type PendingGesture = {
  text: string;
  gesture: AvatarGestureName;
  createdAt: number;
};

const MAX_AGE_MS = 60_000;

function store(): Map<string, PendingGesture> {
  const g = globalThis as any;
  if (!g.__streamweaver_pending_avatar_gestures) g.__streamweaver_pending_avatar_gestures = new Map<string, PendingGesture>();
  return g.__streamweaver_pending_avatar_gestures;
}

function key(tenantId?: string): string {
  return String(tenantId || 'global');
}

function normalize(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function rememberAvatarGesture(tenantId: string | undefined, text: string, gesture: AvatarGestureName): void {
  store().set(key(tenantId), { text: normalize(text), gesture, createdAt: Date.now() });
}

export function consumeAvatarGesture(tenantId: string | undefined, text: string): AvatarGestureName | undefined {
  const pending = store().get(key(tenantId));
  if (!pending) return undefined;
  if (Date.now() - pending.createdAt > MAX_AGE_MS) {
    store().delete(key(tenantId));
    return undefined;
  }
  if (pending.text !== normalize(text)) return undefined;
  store().delete(key(tenantId));
  return pending.gesture;
}
