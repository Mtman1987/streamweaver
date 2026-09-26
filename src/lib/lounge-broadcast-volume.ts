'use client';

import { useEffect, useState } from 'react';

/** The broadcast source reads the three saved Lounge levels; ordinary player pages keep local volume. */
export function useLoungeBroadcastVolume(output: 'stella' | 'spotlight' | 'media'): number | null {
  const [level, setLevel] = useState<number | null>(null);
  const [source, setSource] = useState({ volume: 1, muted: false });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('placement') !== 'lounge'
      || (params.get('tenant') || params.get('tenantId')) !== 'spacemountainlive') return;

    const onAudio = (event: MessageEvent) => {
      if (event.origin !== 'https://spmt.live' || event.source !== window.parent || event.data?.type !== 'spmt.obspmt.audio') return;
      const volume = Number(event.data.volume);
      if (!Number.isFinite(volume) || volume < 0 || volume > 1 || typeof event.data.muted !== 'boolean') return;
      setSource({ volume, muted: event.data.muted });
    };
    window.addEventListener('message', onAudio);
    let stopped = false;
    setLevel(output === 'spotlight' ? 0.58 : output === 'media' ? 0.85 : 1);
    const refresh = async () => {
      try {
        const response = await fetch('/api/lounge/audio-mix', { cache: 'no-store' });
        if (!response.ok) return;
        const levels = (await response.json())?.levels;
        const value = Number(levels?.[output]);
        const master = levels?.all === undefined ? 100 : Number(levels.all);
        if (!stopped && Number.isInteger(value) && value >= 0 && value <= 100
          && Number.isInteger(master) && master >= 0 && master <= 100) {
          setLevel((value / 100) * (master / 100));
        }
      } catch {}
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('message', onAudio); };
  }, [output]);

  return level === null ? null : level * (source.muted ? 0 : source.volume);
}
