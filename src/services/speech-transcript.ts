function comparableSpeech(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mergeSpeechRecognitionSegments(segments: string[]): string {
  const merged: string[] = [];

  for (const value of segments) {
    const segment = String(value || '').replace(/\s+/g, ' ').trim();
    if (!segment) continue;

    const current = merged.join(' ').trim();
    const comparableCurrent = comparableSpeech(current);
    const comparableSegment = comparableSpeech(segment);

    if (!current) {
      merged.push(segment);
    } else if (comparableSegment.startsWith(comparableCurrent)) {
      merged.splice(0, merged.length, segment);
    } else if (comparableCurrent.endsWith(comparableSegment)) {
      continue;
    } else {
      const lastIndex = merged.length - 1;
      const comparableLast = comparableSpeech(merged[lastIndex]);
      if (comparableSegment.startsWith(comparableLast)) {
        merged[lastIndex] = segment;
      } else {
        merged.push(segment);
      }
    }
  }

  return merged.join(' ').replace(/\s+/g, ' ').trim();
}
