export type AvatarGestureDirective = {
  spokenText: string;
  gesture: string | null;
};

const DIRECTIVE_PATTERN = /\[(?:gesture:)?([a-z0-9][a-z0-9_-]{0,47})(?:_gesture)?\]/gi;

export function normalizeGestureName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_gesture$/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function parseAvatarGestureDirective(value: unknown): AvatarGestureDirective {
  const input = String(value || '');
  let gesture: string | null = null;
  const spokenText = input
    .replace(DIRECTIVE_PATTERN, (_match, rawName: string) => {
      if (!gesture) gesture = normalizeGestureName(rawName);
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();

  return { spokenText, gesture };
}
