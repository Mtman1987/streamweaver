export async function getSavedSink(): Promise<string | null> {
  try {
    const res = await fetch('/api/audio/settings');
    if (!res.ok) return null;
    const data = await res.json();
    return data?.output || null;
  } catch (e) {
    console.warn('[AudioSink] Failed to get saved sink', e);
    return null;
  }
}

export async function applySavedSink(audio: HTMLMediaElement): Promise<void> {
  try {
    const sinkId = await getSavedSink();
    if (sinkId && (audio as any).setSinkId) {
      await (audio as any).setSinkId(sinkId);
      console.log('[AudioSink] Applied sinkId', sinkId);
    }
  } catch (e) {
    console.warn('[AudioSink] applySavedSink failed', e);
  }
}
