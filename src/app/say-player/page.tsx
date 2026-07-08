'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export default function SayPlayer() {
  const playing = useRef(false);
  const queue = useRef<Array<{ id: number; audioUrl: string }>>([]);
  const knownIds = useRef<Set<number>>(new Set());
  const lastSeenId = useRef(0);
  const ready = useRef(false);
  const needsLiveResync = useRef(false);
  const [active, setActive] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [volume, setVolume] = useState(0.6);
  const [status, setStatus] = useState('Click to unlock browser audio.');

  useEffect(() => {
    const nextTenantId = new URLSearchParams(window.location.search).get('tenantId') || '';
    setTenantId(nextTenantId);
    try {
      lastSeenId.current = Number(localStorage.getItem(`streamweaver-say-last-${nextTenantId || 'global'}`) || 0);
    } catch {}
    try {
      const savedVolume = Number(localStorage.getItem('streamweaver-say-volume') || '');
      if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) setVolume(savedVolume);
    } catch {}
  }, []);

  function updateVolume(nextVolume: number) {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    setVolume(clamped);
    try {
      localStorage.setItem('streamweaver-say-volume', String(clamped));
    } catch {}
  }

  function start() {
    setActive(true);
    setStatus('Joining live messages...');
  }

  const syncToLatest = useCallback(async (message = 'Listening for new messages...') => {
    queue.current = [];
    knownIds.current.clear();
    ready.current = false;
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    params.set('latest', '1');
    const res = await fetch(`/api/say/next?${params.toString()}`);
    const { latestId } = await res.json();
    lastSeenId.current = Math.max(0, Number(latestId || 0));
    try {
      localStorage.setItem(`streamweaver-say-last-${tenantId || 'global'}`, String(lastSeenId.current));
    } catch {}
    ready.current = true;
    needsLiveResync.current = false;
    setStatus(message);
  }, [tenantId]);

  const resetCursor = useCallback(() => {
    syncToLatest('Skipped old messages. Listening live from now...');
  }, [syncToLatest]);

  useEffect(() => {
    if (!active) return;
    syncToLatest().catch(() => {
      ready.current = true;
      setStatus('Could not sync live position. Retrying...');
    });
  }, [active, syncToLatest]);

  useEffect(() => {
    if (!active) return;
    const poll = setInterval(async () => {
      try {
        if (!ready.current) return;
        if (needsLiveResync.current) {
          await syncToLatest('Reconnected. Skipped missed messages and listening live...');
          return;
        }
        const params = new URLSearchParams();
        if (tenantId) params.set('tenantId', tenantId);
        params.set('after', String(lastSeenId.current));
        const query = `?${params.toString()}`;
        const res = await fetch(`/api/say/next${query}`);
        const { items, latestId } = await res.json();
        if (!items?.length && Number(latestId || 0) > 0 && Number(latestId || 0) < lastSeenId.current) {
          resetCursor();
          return;
        }
        if (Array.isArray(items)) {
          items.forEach((item) => {
            const id = Number(item?.id || 0);
            if (id && item?.audioUrl && !knownIds.current.has(id)) {
              knownIds.current.add(id);
              queue.current.push(item);
            }
          });
        }
        if (playing.current || !queue.current.length) return;
        const next = queue.current.shift();
        if (!next) return;
        playing.current = true;
        const audio = new Audio(next.audioUrl);
        audio.volume = volume;
        const markPlayed = () => {
          lastSeenId.current = Math.max(lastSeenId.current, Number(next.id || 0));
          try {
            localStorage.setItem(`streamweaver-say-last-${tenantId || 'global'}`, String(lastSeenId.current));
          } catch {}
        };
        audio.onended = () => {
          markPlayed();
          playing.current = false;
          setStatus('Listening for messages...');
        };
        audio.onerror = () => {
          markPlayed();
          playing.current = false;
          setStatus('Audio failed. Waiting for next message...');
        };
        setStatus('Playing message...');
        audio.play().catch((error) => {
          playing.current = false;
          knownIds.current.delete(Number(next.id || 0));
          queue.current.unshift(next);
          setStatus(`Audio blocked: ${error?.message || 'click Reset and tap the page again'}`);
        });
      } catch {
        needsLiveResync.current = true;
        setStatus('Connection interrupted. Will resume live messages...');
      }
    }, 500);
    return () => clearInterval(poll);
  }, [active, resetCursor, syncToLatest, tenantId, volume]);

  if (!active) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', cursor: 'pointer' }} onClick={start}>
        <h1 style={{ fontSize: '6rem', color: '#0f0', fontFamily: 'monospace', textAlign: 'center' }}>CLICK HERE TO HEAR TTS</h1>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', color: '#0f0', fontFamily: 'monospace', textAlign: 'center' }}>
      <p style={{ fontSize: '2rem' }}>Say Player Active - listening for messages</p>
      <p style={{ fontSize: '1rem', color: '#9f9' }}>{status}</p>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1rem', color: '#9f9' }}>
        Volume
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(volume * 100)}
          onChange={(event) => updateVolume(Number(event.target.value) / 100)}
          style={{ width: 'min(70vw, 320px)' }}
        />
        <span style={{ minWidth: '3ch', textAlign: 'right' }}>{Math.round(volume * 100)}%</span>
      </label>
      <button
        onClick={resetCursor}
        style={{ border: '1px solid #0f0', background: '#020', color: '#0f0', padding: '0.75rem 1rem', fontFamily: 'monospace', cursor: 'pointer' }}
      >
        Reset listener
      </button>
    </div>
  );
}
