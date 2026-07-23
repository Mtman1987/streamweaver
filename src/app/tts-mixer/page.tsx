'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type StreamInfo = {
  tenantId: string;
  itemCount: number;
  latestId: number;
  lastActiveAt: string | null;
};

type PendingAudio = {
  key: string;
  tenantId: string;
  id: number;
  audioUrl: string;
  addedAt: string;
};

export default function TtsMixerPage() {
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [status, setStatus] = useState('Choose one or more active TTS streams, then enable audio.');
  const cursors = useRef<Record<string, number>>({});
  const queued = useRef<Set<string>>(new Set());
  const pending = useRef<PendingAudio[]>([]);
  const playing = useRef(false);
  const playNextRef = useRef<() => void>(() => {});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = (params.get('streams') || params.get('tenantIds') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    setSelected(Array.from(new Set(initial)));
    const requestedVolume = Number(params.get('volume'));
    if (Number.isFinite(requestedVolume)) setVolume(Math.max(0, Math.min(1, requestedVolume)));
  }, []);

  const refreshStreams = useCallback(async () => {
    const response = await fetch('/api/say/streams', { cache: 'no-store' });
    const data = response.ok ? await response.json() : { streams: [] };
    const next = Array.isArray(data?.streams) ? data.streams : [];
    setStreams(next);
  }, []);

  useEffect(() => {
    refreshStreams().catch(() => setStatus('Could not load active TTS streams.'));
    const interval = window.setInterval(() => refreshStreams().catch(() => {}), 3000);
    return () => window.clearInterval(interval);
  }, [refreshStreams]);

  const playNext = useCallback(() => {
    if (playing.current || pending.current.length === 0) return;
    const next = pending.current.shift();
    if (!next) return;
    playing.current = true;
    const audio = new Audio(next.audioUrl);
    audio.volume = muted ? 0 : volume;
    setStatus(`Playing ${next.tenantId}`);
    const finish = () => {
      cursors.current[next.tenantId] = Math.max(cursors.current[next.tenantId] || 0, next.id);
      playing.current = false;
      setStatus('Listening for selected TTS streams...');
      playNextRef.current();
    };
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch(() => {
      playing.current = false;
      pending.current.unshift(next);
      setEnabled(false);
      setStatus('Browser audio was blocked. Click Enable audio again.');
    });
  }, [muted, volume]);
  playNextRef.current = playNext;

  useEffect(() => {
    if (!enabled || selected.length === 0) return;
    let cancelled = false;
    const sync = async () => {
      await Promise.all(selected.map(async (tenantId) => {
        if (cursors.current[tenantId] !== undefined) return;
        const params = new URLSearchParams({ tenantId, latest: '1' });
        const response = await fetch(`/api/say/next?${params.toString()}`);
        const data = response.ok ? await response.json() : {};
        cursors.current[tenantId] = Number(data.latestId || 0);
      }));
      if (!cancelled) setStatus('Listening for selected TTS streams...');
    };
    sync().catch(() => setStatus('Could not sync the selected TTS streams.'));

    const interval = window.setInterval(async () => {
      const discovered: PendingAudio[] = [];
      await Promise.all(selected.map(async (tenantId) => {
        const params = new URLSearchParams({ tenantId, after: String(cursors.current[tenantId] || 0) });
        const response = await fetch(`/api/say/next?${params.toString()}`);
        const data = response.ok ? await response.json() : {};
        for (const item of Array.isArray(data?.items) ? data.items : []) {
          const key = `${tenantId}:${item.id}`;
          if (!item?.audioUrl || queued.current.has(key)) continue;
          queued.current.add(key);
          discovered.push({ key, tenantId, id: Number(item.id), audioUrl: item.audioUrl, addedAt: item.addedAt || new Date().toISOString() });
        }
      })).catch(() => {});
      if (cancelled || discovered.length === 0) return;
      pending.current.push(...discovered.sort((a, b) => a.addedAt.localeCompare(b.addedAt)));
      playNext();
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, playNext, selected]);

  useEffect(() => {
    if (!enabled || selected.length === 0) return;
    const heartbeat = () => {
      selected.forEach((tenantId) => {
        fetch('/api/tts/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, kind: 'mixer', scope: 'say' }),
          keepalive: true,
        }).catch(() => {});
      });
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 10_000);
    return () => window.clearInterval(interval);
  }, [enabled, selected]);

  const toggleStream = (tenantId: string) => {
    setSelected((current) => current.includes(tenantId)
      ? current.filter((item) => item !== tenantId)
      : [...current, tenantId]);
  };

  return (
    <main style={{ minHeight: '100vh', padding: 18, background: 'radial-gradient(circle at top, #132445, #05070d 62%)', color: '#f5f7ff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: '#67e8f9', fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase' }}>StreamWeaver</div>
          <h1 style={{ margin: '3px 0 0', fontSize: 22 }}>Shared TTS Mixer</h1>
          <p style={{ margin: '5px 0 0', color: '#9ca3af', fontSize: 12 }}>Listen to any combination of active replayable TTS streams through one player.</p>
        </div>
        <button onClick={() => setEnabled((value) => !value)} style={{ border: '1px solid #22d3ee66', borderRadius: 10, background: enabled ? '#164e63' : '#22d3ee', color: enabled ? '#cffafe' : '#06202a', padding: '9px 13px', fontWeight: 800, cursor: 'pointer' }}>
          {enabled ? 'Pause listening' : 'Enable audio'}
        </button>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 9 }}>
        {streams.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No TTS streams have been active since this server started.</div>
        ) : streams.map((stream) => {
          const active = selected.includes(stream.tenantId);
          return (
            <button key={stream.tenantId} onClick={() => toggleStream(stream.tenantId)} style={{ textAlign: 'left', border: `1px solid ${active ? '#22d3ee88' : '#ffffff18'}`, borderRadius: 12, background: active ? '#0891b21f' : '#ffffff0a', color: '#f8fafc', padding: 11, cursor: 'pointer' }}>
              <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stream.tenantId}</strong>
              <span style={{ display: 'block', marginTop: 4, color: '#94a3b8', fontSize: 11 }}>{stream.itemCount} buffered • {active ? 'selected' : 'tap to listen'}</span>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 16, border: '1px solid #ffffff18', borderRadius: 12, background: '#00000038', padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setMuted((value) => !value)} style={{ border: '1px solid #ffffff22', borderRadius: 8, background: '#ffffff0c', color: '#f8fafc', padding: '7px 10px', cursor: 'pointer' }}>{muted ? 'Unmute' : 'Mute'}</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: '#cbd5e1', flex: 1, minWidth: 220 }}>
          Volume
          <input type="range" min="0" max="100" value={Math.round(volume * 100)} onChange={(event) => setVolume(Number(event.target.value) / 100)} style={{ flex: 1 }} />
          {Math.round(volume * 100)}%
        </label>
      </div>
      <p style={{ marginTop: 10, color: '#94a3b8', fontSize: 11 }}>{status}</p>
    </main>
  );
}
