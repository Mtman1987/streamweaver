'use client';

import { useEffect, useRef, useState } from 'react';

export default function SayPlayer() {
  const playing = useRef(false);
  const queue = useRef<Array<{ id: number; audioUrl: string }>>([]);
  const lastSeenId = useRef(0);
  const [active, setActive] = useState(false);
  const [tenantId, setTenantId] = useState('');

  useEffect(() => {
    const nextTenantId = new URLSearchParams(window.location.search).get('tenantId') || '';
    setTenantId(nextTenantId);
    try {
      lastSeenId.current = Number(localStorage.getItem(`streamweaver-say-last-${nextTenantId || 'global'}`) || 0);
    } catch {}
  }, []);

  function start() {
    setActive(true);
  }

  useEffect(() => {
    if (!active) return;
    const poll = setInterval(async () => {
      try {
        const params = new URLSearchParams();
        if (tenantId) params.set('tenantId', tenantId);
        params.set('after', String(lastSeenId.current));
        const query = `?${params.toString()}`;
        const res = await fetch(`/api/say/next${query}`);
        const { items } = await res.json();
        if (Array.isArray(items)) {
          const knownIds = new Set(queue.current.map((item) => item.id));
          items.forEach((item) => {
            if (item?.id && item?.audioUrl && !knownIds.has(item.id)) queue.current.push(item);
          });
        }
        if (playing.current || !queue.current.length) return;
        const next = queue.current.shift();
        if (!next) return;
        playing.current = true;
        lastSeenId.current = Math.max(lastSeenId.current, Number(next.id || 0));
        try {
          localStorage.setItem(`streamweaver-say-last-${tenantId || 'global'}`, String(lastSeenId.current));
        } catch {}
        const audio = new Audio(next.audioUrl);
        audio.onended = () => { playing.current = false; };
        audio.onerror = () => { playing.current = false; };
        audio.play().catch(() => { playing.current = false; });
      } catch { /* ignore */ }
    }, 500);
    return () => clearInterval(poll);
  }, [active, tenantId]);

  if (!active) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', cursor: 'pointer' }} onClick={start}>
        <h1 style={{ fontSize: '6rem', color: '#0f0', fontFamily: 'monospace', textAlign: 'center' }}>CLICK HERE TO HEAR TTS</h1>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', color: '#0f0', fontFamily: 'monospace' }}>
      <p style={{ fontSize: '2rem' }}>🔊 Say Player Active — listening for messages</p>
    </div>
  );
}
