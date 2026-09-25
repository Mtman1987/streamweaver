import { EventEmitter } from 'node:events';

export type TranslationSubtitleEvent = {
  type: 'translation-subtitle';
  eventId: string;
  createdAt: string;
  tenantId?: string;
  username: string;
  displayName: string;
  sourceText: string;
  translatedText: string;
  targetLanguage: string;
  durationMs: number;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(100);
const recent: TranslationSubtitleEvent[] = [];
const MAX_RECENT = 100;

export function publishTranslationSubtitleEvent(
  input: Omit<TranslationSubtitleEvent, 'type' | 'eventId' | 'createdAt'>,
): TranslationSubtitleEvent {
  const event: TranslationSubtitleEvent = {
    ...input,
    type: 'translation-subtitle',
    eventId: `translation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
  recent.push(event);
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
  emitter.emit('event', event);
  return event;
}

export function getTranslationSubtitleEvents(input: { tenantId?: string; after?: string; limit?: number } = {}) {
  const afterTime = input.after ? Date.parse(input.after) : 0;
  const limit = Math.max(1, Math.min(50, Number(input.limit || 20)));
  return recent
    .filter((event) => !input.tenantId || event.tenantId === input.tenantId)
    .filter((event) => !afterTime || Date.parse(event.createdAt) > afterTime)
    .slice(-limit);
}
