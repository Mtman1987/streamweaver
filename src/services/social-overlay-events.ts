import { EventEmitter } from 'node:events';

export const SOCIAL_OVERLAY_COMMANDS = [
  'hug', 'boop', 'cuddle', 'fistbump', 'headpat', 'highfive', 'love', 'tickle',
  'hover', 'lurk', 'unlurk',
] as const;

export type SocialOverlayCommand = typeof SOCIAL_OVERLAY_COMMANDS[number];

export type SocialOverlayEvent = {
  type: 'social-command';
  eventId: string;
  createdAt: string;
  command: SocialOverlayCommand;
  tenantId?: string;
  actor: {
    id?: string;
    name: string;
    avatarUrl?: string;
  };
  target?: {
    id?: string;
    name: string;
    avatarUrl?: string;
  };
  bot: {
    name: string;
    avatarUrl?: string;
  };
  animation: {
    theme: SocialOverlayCommand;
    durationMs: number;
    particleCount: number;
    reducedMotionSafe: true;
  };
};

const socialOverlayEmitter = new EventEmitter();
socialOverlayEmitter.setMaxListeners(100);
const recentSocialOverlayEvents: SocialOverlayEvent[] = [];
const MAX_RECENT_SOCIAL_EVENTS = 100;

export function isSocialOverlayCommand(command: string): command is SocialOverlayCommand {
  return (SOCIAL_OVERLAY_COMMANDS as readonly string[]).includes(String(command || '').toLowerCase());
}

export function publishSocialOverlayEvent(
  input: Omit<SocialOverlayEvent, 'type' | 'eventId' | 'createdAt'>,
): SocialOverlayEvent {
  const event: SocialOverlayEvent = {
    ...input,
    type: 'social-command',
    eventId: `social-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
  recentSocialOverlayEvents.push(event);
  if (recentSocialOverlayEvents.length > MAX_RECENT_SOCIAL_EVENTS) {
    recentSocialOverlayEvents.splice(0, recentSocialOverlayEvents.length - MAX_RECENT_SOCIAL_EVENTS);
  }
  socialOverlayEmitter.emit('event', event);
  return event;
}

export function subscribeToSocialOverlayEvents(
  listener: (event: SocialOverlayEvent) => void,
): () => void {
  socialOverlayEmitter.on('event', listener);
  return () => socialOverlayEmitter.off('event', listener);
}


export function getSocialOverlayEvents(input: {
  tenantId?: string;
  after?: string;
  limit?: number;
} = {}): SocialOverlayEvent[] {
  const afterTime = input.after ? Date.parse(input.after) : 0;
  const limit = Math.max(1, Math.min(50, Number(input.limit || 20)));
  return recentSocialOverlayEvents
    .filter((event) => !input.tenantId || event.tenantId === input.tenantId)
    .filter((event) => !afterTime || Date.parse(event.createdAt) > afterTime)
    .slice(-limit);
}
