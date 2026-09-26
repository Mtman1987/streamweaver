'use client';

import { useEffect, useState } from 'react';

/** The broadcast source reads the three saved Lounge levels; ordinary player pages keep local volume. */
export function useLoungeBroadcastVolume(output: 'stella' | 'spotlight' | 'media'): number | null {
  const [level, setLevel] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('placement') !== 'lounge'
      || (params.get('tenant') || params.get('tenantId')) !== 'spacemountainlive') return;

    let stopped = false;
    setLevel(output === 'spotlight' ? 0.58 : output === 'media' ? 0.85 : 1);
    const refresh = async () => {
      try {
        const response = await fetch('/api/lounge/audio-mix', { cache: 'no-store' });
        if (!response.ok) return;
        const value = Number((await response.json())?.levels?.[output]);
        if (!stopped && Number.isInteger(value) && value >= 1 && value <= 100) setLevel(value / 100);
      } catch {}
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [output]);

  return level;
}
