export const AVATAR_GESTURES = [
  'wave_gesture',
  'blow_kiss_gesture',
  'spin_gesture',
  'playful_tilt_gesture',
  'laugh_gesture',
  'happy_gesture',
] as const;

export type AvatarGestureName = typeof AVATAR_GESTURES[number];

const GESTURE_SET = new Set<string>(AVATAR_GESTURES);
const GESTURE_TAG_RE = /\[([a-z_]+_gesture)\]/gi;

export const AVATAR_GESTURE_PROMPT = [
  'You may optionally choose one avatar gesture for the end of this reply.',
  'If a gesture fits naturally, append exactly one tag as the final token of the reply.',
  'Allowed tags: [wave_gesture], [blow_kiss_gesture], [spin_gesture], [playful_tilt_gesture], [laugh_gesture], [happy_gesture].',
  'Use wave_gesture for greetings/goodbyes/acknowledgement; blow_kiss_gesture for affection or warm appreciation; spin_gesture for strong excitement or celebration; playful_tilt_gesture for curiosity, teasing, or playful uncertainty; laugh_gesture for genuine amusement; happy_gesture for general happiness, praise, or positive excitement.',
  'Do not use a gesture on every reply. Use no tag when a gesture would feel forced.',
  'Gesture tags are silent control metadata for the avatar. Never say or explain the tag in prose.',
  'Never place a gesture tag anywhere except the very end.',
].join(' ');

export function extractAvatarGesture(value: unknown): { text: string; gesture?: AvatarGestureName } {
  const input = String(value || '').trim();
  if (!input) return { text: '' };

  let gesture: AvatarGestureName | undefined;
  const text = input
    .replace(GESTURE_TAG_RE, (_full, rawGesture: string) => {
      const candidate = String(rawGesture || '').toLowerCase();
      if (!gesture && GESTURE_SET.has(candidate)) {
        gesture = candidate as AvatarGestureName;
      }
      // Any *_gesture bracket token is control metadata, even if the model
      // invents an unsupported one. Never leak it to chat, captions, or TTS.
      return ' ';
    })
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return gesture ? { text, gesture } : { text };
}
