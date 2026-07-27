export type ShoutoutMode = 'full' | 'overlay' | 'chat';

export function resolveShoutoutMode(input: {
  persistedMode?: string;
  legacySkipOverlay?: boolean;
}): ShoutoutMode {
  const mode = String(input.persistedMode || '').trim().toLowerCase();
  if (mode === 'full' || mode === 'overlay' || mode === 'chat') return mode;
  if (mode === 'on') return 'full';
  if (mode === 'off') return 'chat';
  return input.legacySkipOverlay ? 'chat' : 'full';
}
