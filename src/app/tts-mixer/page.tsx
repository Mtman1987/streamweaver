'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TTS_VOICE_OPTIONS, normalizeTtsVoice } from '@/lib/tts-voices';

type StreamInfo = {
  tenantId: string;
  label: string;
  overlayItems: number;
  sayItems: number;
  lastActiveAt: string | null;
  listenerActive: boolean;
};

type PendingAudio = {
  key: string;
  tenantId: string;
  id: string;
  source: 'overlay' | 'say';
  audioUrl: string;
  addedAt: string;
};

type MixerPreferences = {
  selected: string[];
  order: string[];
  volume: number;
  perTenantVolume: Record<string, number>;
  voice: string;
  pttKey: string;
  layout: 'grid' | 'compact';
  includeOverlay: boolean;
  includeSay: boolean;
};

const STORAGE_KEY = 'streamweaver:tts-mixer:v2';
const defaultPreferences: MixerPreferences = {
  selected: [],
  order: [],
  volume: 0.7,
  perTenantVolume: {},
  voice: '',
  pttKey: 'Space',
  layout: 'grid',
  includeOverlay: true,
  includeSay: true,
};

const voiceOptions = [
  { id: '', label: 'Tenant default' },
  ...TTS_VOICE_OPTIONS.map((voice) => ({
    id: voice.id,
    label: `${voice.label} — ${voice.providerLabel}`,
  })),
];

function clampVolume(value: unknown, fallback = 0.7) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function loadPreferences(): MixerPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {};
    const params = new URLSearchParams(window.location.search);
    const queryStreams = (params.get('streams') || params.get('tenantIds') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return {
      ...defaultPreferences,
      ...saved,
      selected: queryStreams.length ? Array.from(new Set(queryStreams)) : (Array.isArray(saved.selected) ? saved.selected : []),
      order: Array.isArray(saved.order) ? saved.order : [],
      volume: clampVolume(params.get('volume') ?? saved.volume),
      perTenantVolume: saved.perTenantVolume && typeof saved.perTenantVolume === 'object' ? saved.perTenantVolume : {},
      voice: saved.voice ? normalizeTtsVoice(saved.voice) : '',
      pttKey: String(saved.pttKey || defaultPreferences.pttKey),
      layout: params.get('layout') === 'compact' || saved.layout === 'compact' ? 'compact' : 'grid',
      includeOverlay: saved.includeOverlay !== false,
      includeSay: saved.includeSay !== false,
    };
  } catch {
    return defaultPreferences;
  }
}

export default function TtsMixerPage() {
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [preferences, setPreferences] = useState<MixerPreferences>(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState('Choose tenant streams, then enable audio.');
  const [micActive, setMicActive] = useState(false);
  const [micTranscript, setMicTranscript] = useState('');
  const [postingAs, setPostingAs] = useState('');
  const recognitionRef = useRef<any>(null);
  const cursors = useRef<Record<string, string>>({});
  const queued = useRef<Set<string>>(new Set());
  const pending = useRef<PendingAudio[]>([]);
  const playing = useRef(false);
  const playNextRef = useRef<() => void>(() => {});

  useEffect(() => {
    setPreferences(loadPreferences());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences, ready]);

  const selectedSet = useMemo(() => new Set(preferences.selected), [preferences.selected]);
  const orderedStreams = useMemo(() => {
    const rank = new Map(preferences.order.map((tenantId, index) => [tenantId, index]));
    return [...streams].sort((a, b) => (
      (rank.get(a.tenantId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.tenantId) ?? Number.MAX_SAFE_INTEGER)
      || a.label.localeCompare(b.label)
    ));
  }, [preferences.order, streams]);

  const refreshStreams = useCallback(async () => {
    const [overlayResponse, sayResponse] = await Promise.all([
      fetch('/api/tts/streams', { cache: 'no-store' }),
      fetch('/api/say/streams', { cache: 'no-store' }),
    ]);
    const overlayData = overlayResponse.ok ? await overlayResponse.json() : { streams: [] };
    const sayData = sayResponse.ok ? await sayResponse.json() : { streams: [] };
    const merged = new Map<string, StreamInfo>();

    for (const stream of Array.isArray(overlayData?.streams) ? overlayData.streams : []) {
      merged.set(stream.tenantId, {
        tenantId: stream.tenantId,
        label: stream.label || stream.tenantId,
        overlayItems: Number(stream.itemCount || 0),
        sayItems: 0,
        lastActiveAt: stream.lastActiveAt || null,
        listenerActive: Boolean(stream.listenerActive),
      });
    }
    for (const stream of Array.isArray(sayData?.streams) ? sayData.streams : []) {
      const current = merged.get(stream.tenantId);
      merged.set(stream.tenantId, {
        tenantId: stream.tenantId,
        label: current?.label || stream.tenantId,
        overlayItems: current?.overlayItems || 0,
        sayItems: Number(stream.itemCount || 0),
        lastActiveAt: [current?.lastActiveAt, stream.lastActiveAt].filter(Boolean).sort().at(-1) || null,
        listenerActive: current?.listenerActive || false,
      });
    }
    setStreams(Array.from(merged.values()));
  }, []);

  useEffect(() => {
    refreshStreams().catch(() => setStatus('Could not load tenant TTS streams.'));
    const interval = window.setInterval(() => refreshStreams().catch(() => {}), 5000);
    return () => window.clearInterval(interval);
  }, [refreshStreams]);

  useEffect(() => {
    fetch('/api/say/chat')
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (response.ok && data?.identity?.username) setPostingAs(data.identity.username);
      })
      .catch(() => {});
  }, []);

  const playNext = useCallback(() => {
    if (playing.current || pending.current.length === 0) return;
    const next = pending.current.shift();
    if (!next) return;
    playing.current = true;
    const audio = new Audio(next.audioUrl);
    const tenantVolume = clampVolume(preferences.perTenantVolume[next.tenantId], 1);
    audio.volume = muted ? 0 : clampVolume(preferences.volume * tenantVolume);
    setStatus(`Playing ${next.source === 'say' ? 'chat TTS' : 'bot TTS'} from ${next.tenantId}`);
    const finish = () => {
      cursors.current[`${next.source}:${next.tenantId}`] = next.id;
      playing.current = false;
      setStatus('Listening across selected tenant streams...');
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
  }, [muted, preferences.perTenantVolume, preferences.volume]);
  playNextRef.current = playNext;

  useEffect(() => {
    cursors.current = {};
    queued.current.clear();
    pending.current = [];
  }, [preferences.includeOverlay, preferences.includeSay, preferences.selected]);

  useEffect(() => {
    if (!enabled || preferences.selected.length === 0) return;
    let cancelled = false;

    const initialize = async () => {
      await Promise.all(preferences.selected.flatMap((tenantId) => {
        const jobs: Promise<void>[] = [];
        if (preferences.includeOverlay) {
          jobs.push(fetch(`/api/tts/current?latest=1&tenant=${encodeURIComponent(tenantId)}`)
            .then((response) => response.json())
            .then((data) => { cursors.current[`overlay:${tenantId}`] = String(data.cursor || ''); }));
        }
        if (preferences.includeSay) {
          jobs.push(fetch(`/api/say/next?latest=1&tenantId=${encodeURIComponent(tenantId)}`)
            .then((response) => response.json())
            .then((data) => { cursors.current[`say:${tenantId}`] = String(data.latestId || 0); }));
        }
        return jobs;
      }));
      if (!cancelled) setStatus('Listening across selected tenant streams...');
    };
    initialize().catch(() => setStatus('Could not sync the selected streams.'));

    const interval = window.setInterval(async () => {
      const discovered: PendingAudio[] = [];
      await Promise.all(preferences.selected.flatMap((tenantId) => {
        const jobs: Promise<void>[] = [];
        if (preferences.includeOverlay) {
          const cursor = cursors.current[`overlay:${tenantId}`] || '';
          jobs.push(fetch(`/api/tts/current?next=1&tenant=${encodeURIComponent(tenantId)}${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`)
            .then((response) => response.json())
            .then((item) => {
              if (!item?.audioUrl || !item?.cursor) return;
              const key = `overlay:${tenantId}:${item.cursor}`;
              if (queued.current.has(key)) return;
              queued.current.add(key);
              discovered.push({
                key,
                tenantId,
                id: String(item.cursor),
                source: 'overlay',
                audioUrl: item.audioUrl,
                addedAt: item.updatedAt || new Date().toISOString(),
              });
            }));
        }
        if (preferences.includeSay) {
          const cursor = cursors.current[`say:${tenantId}`] || '0';
          jobs.push(fetch(`/api/say/next?tenantId=${encodeURIComponent(tenantId)}&after=${encodeURIComponent(cursor)}`)
            .then((response) => response.json())
            .then((data) => {
              for (const item of Array.isArray(data?.items) ? data.items : []) {
                const key = `say:${tenantId}:${item.id}`;
                if (!item?.audioUrl || queued.current.has(key)) continue;
                queued.current.add(key);
                discovered.push({
                  key,
                  tenantId,
                  id: String(item.id),
                  source: 'say',
                  audioUrl: item.audioUrl,
                  addedAt: item.addedAt || new Date().toISOString(),
                });
              }
            }));
        }
        return jobs;
      })).catch(() => {});

      if (cancelled || discovered.length === 0) return;
      pending.current.push(...discovered.sort((a, b) => a.addedAt.localeCompare(b.addedAt)));
      playNext();
    }, 600);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, playNext, preferences.includeOverlay, preferences.includeSay, preferences.selected]);

  useEffect(() => {
    if (!enabled || preferences.selected.length === 0) return;
    const heartbeat = () => {
      preferences.selected.forEach((tenantId) => {
        const scopes = [
          ...(preferences.includeOverlay ? ['overlay'] as const : []),
          ...(preferences.includeSay ? ['say'] as const : []),
        ];
        scopes.forEach((scope) => {
          fetch('/api/tts/presence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, kind: 'mixer', scope }),
            keepalive: true,
          }).catch(() => {});
        });
      });
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 10_000);
    return () => window.clearInterval(interval);
  }, [enabled, preferences.includeOverlay, preferences.includeSay, preferences.selected]);

  const toggleStream = (tenantId: string) => {
    setPreferences((current) => {
      const selected = current.selected.includes(tenantId)
        ? current.selected.filter((item) => item !== tenantId)
        : [...current.selected, tenantId];
      return {
        ...current,
        selected,
        order: current.order.includes(tenantId) ? current.order : [...current.order, tenantId],
      };
    });
  };

  const moveStream = (tenantId: string, direction: -1 | 1) => {
    setPreferences((current) => {
      const order = Array.from(new Set([...current.order, ...streams.map((stream) => stream.tenantId)]));
      const index = order.indexOf(tenantId);
      const nextIndex = Math.max(0, Math.min(order.length - 1, index + direction));
      if (index < 0 || index === nextIndex) return current;
      [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
      return { ...current, order };
    });
  };

  const stopMic = useCallback(() => {
    recognitionRef.current?.stop();
    setMicActive(false);
  }, []);

  const startMic = useCallback(() => {
    if (micActive) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('Speech recognition is not supported in this browser.');
      return;
    }
    const targetTenant = preferences.selected[0];
    if (!targetTenant) {
      setStatus('Select at least one tenant. PTT posts to the first selected tenant.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;
    recognition.onresult = async (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() || '';
      if (!transcript) return;
      setMicTranscript(transcript);
      setStatus(`Sending to ${targetTenant}: "${transcript}"`);
      try {
        const response = await fetch('/api/say/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: transcript,
            streamKey: targetTenant,
            voice: preferences.voice || undefined,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) {
          throw new Error(response.status === 401 ? 'Open this mixer in a popout and sign in to StreamWeaver' : (data?.error || 'PTT post failed'));
        }
        if (data?.identity?.username) setPostingAs(data.identity.username);
        setStatus(`PTT sent to ${targetTenant}. Listening for TTS...`);
      } catch (error: any) {
        setStatus(error?.message || 'PTT post failed.');
      }
    };
    recognition.onerror = () => {
      setMicActive(false);
      setStatus('Microphone recognition failed. Check browser microphone permission.');
    };
    recognition.onend = () => setMicActive(false);
    recognition.start();
    setMicActive(true);
    setStatus(`PTT listening for ${targetTenant}...`);
  }, [micActive, preferences.selected, preferences.voice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button, [contenteditable="true"]')) return;
      if (event.code !== preferences.pttKey || event.repeat) return;
      event.preventDefault();
      startMic();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== preferences.pttKey) return;
      event.preventDefault();
      stopMic();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [preferences.pttKey, startMic, stopMic]);

  const copyOverlayUrl = async () => {
    const url = new URL(window.location.href);
    url.search = '';
    if (preferences.selected.length) url.searchParams.set('streams', preferences.selected.join(','));
    url.searchParams.set('volume', String(preferences.volume));
    url.searchParams.set('layout', preferences.layout);
    await navigator.clipboard.writeText(url.toString());
    setStatus('Mixer URL copied. Selection, volume, and layout will open with it.');
  };

  return (
    <main style={{ minHeight: '100vh', padding: 18, background: 'radial-gradient(circle at top, #132445, #05070d 62%)', color: '#f5f7ff', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: '#67e8f9', fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase' }}>StreamWeaver · SpaceMountain</div>
          <h1 style={{ margin: '3px 0 0', fontSize: 22 }}>All-Tenant TTS Studio</h1>
          <p style={{ margin: '5px 0 0', color: '#9ca3af', fontSize: 12 }}>Mix bot and chat TTS, arrange tenants, control playback, and use push-to-talk from one overlay.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={copyOverlayUrl} style={buttonStyle(false)}>Copy overlay URL</button>
          <button onClick={() => setEnabled((value) => !value)} style={buttonStyle(enabled)}>
            {enabled ? 'Pause listening' : 'Enable audio'}
          </button>
        </div>
      </header>

      <section style={{ marginTop: 14, border: '1px solid #ffffff18', borderRadius: 14, background: '#00000038', padding: 12, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={labelStyle}><input type="checkbox" checked={preferences.includeOverlay} onChange={(event) => setPreferences((current) => ({ ...current, includeOverlay: event.target.checked }))} /> Bot/overlay TTS</label>
          <label style={labelStyle}><input type="checkbox" checked={preferences.includeSay} onChange={(event) => setPreferences((current) => ({ ...current, includeSay: event.target.checked }))} /> Chat/!say TTS</label>
          <button onClick={() => setMuted((value) => !value)} style={buttonStyle(muted)}>{muted ? 'Unmute' : 'Mute'}</button>
          <label style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
            Master volume
            <input type="range" min="0" max="100" value={Math.round(preferences.volume * 100)} onChange={(event) => setPreferences((current) => ({ ...current, volume: Number(event.target.value) / 100 }))} style={{ flex: 1 }} />
            {Math.round(preferences.volume * 100)}%
          </label>
          <label style={labelStyle}>Layout
            <select value={preferences.layout} onChange={(event) => setPreferences((current) => ({ ...current, layout: event.target.value as MixerPreferences['layout'] }))} style={selectStyle}>
              <option value="grid">Grid</option>
              <option value="compact">Compact list</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid #ffffff12', paddingTop: 12 }}>
          <button onMouseDown={startMic} onMouseUp={stopMic} onMouseLeave={() => micActive && stopMic()} onTouchStart={startMic} onTouchEnd={stopMic} style={buttonStyle(micActive)}>
            {micActive ? 'Release PTT' : 'Hold to talk'}
          </button>
          <label style={labelStyle}>Keyboard PTT
            <select value={preferences.pttKey} onChange={(event) => setPreferences((current) => ({ ...current, pttKey: event.target.value }))} style={selectStyle}>
              <option value="Space">Space</option>
              <option value="KeyV">V</option>
              <option value="KeyB">B</option>
              <option value="ControlLeft">Left Ctrl</option>
              <option value="AltLeft">Left Alt</option>
            </select>
          </label>
          <label style={{ ...labelStyle, flex: 1, minWidth: 260 }}>PTT voice
            <select value={preferences.voice} onChange={(event) => setPreferences((current) => ({ ...current, voice: event.target.value }))} style={{ ...selectStyle, flex: 1 }}>
              {voiceOptions.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
            </select>
          </label>
          <span style={{ color: postingAs ? '#86efac' : '#fbbf24', fontSize: 11 }}>
            {postingAs ? `Signed in as ${postingAs}` : 'PTT requires StreamWeaver sign-in in a top-level popout'}
          </span>
        </div>
      </section>

      <section style={{ marginTop: 16, display: preferences.layout === 'grid' ? 'grid' : 'flex', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', flexDirection: 'column', gap: 9 }}>
        {orderedStreams.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No tenant streams were found.</div>
        ) : orderedStreams.map((stream, index) => {
          const active = selectedSet.has(stream.tenantId);
          const tenantVolume = clampVolume(preferences.perTenantVolume[stream.tenantId], 1);
          return (
            <article key={stream.tenantId} style={{ border: `1px solid ${active ? '#22d3ee88' : '#ffffff18'}`, borderRadius: 12, background: active ? '#0891b21f' : '#ffffff0a', padding: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => toggleStream(stream.tenantId)} aria-pressed={active} style={{ ...buttonStyle(active), flex: 1, textAlign: 'left' }}>
                  <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stream.label}</strong>
                  <span style={{ display: 'block', marginTop: 3, color: '#94a3b8', fontSize: 10 }}>{stream.tenantId}</span>
                </button>
                <button disabled={index === 0} onClick={() => moveStream(stream.tenantId, -1)} style={smallButtonStyle}>↑</button>
                <button disabled={index === orderedStreams.length - 1} onClick={() => moveStream(stream.tenantId, 1)} style={smallButtonStyle}>↓</button>
              </div>
              <div style={{ marginTop: 8, color: '#94a3b8', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{stream.overlayItems} bot · {stream.sayItems} chat</span>
                <span style={{ color: stream.listenerActive ? '#86efac' : '#94a3b8' }}>{stream.listenerActive ? 'listener active' : (active ? 'selected' : 'off')}</span>
              </div>
              {active && (
                <label style={{ ...labelStyle, marginTop: 8 }}>
                  Tenant volume
                  <input type="range" min="0" max="100" value={Math.round(tenantVolume * 100)} onChange={(event) => setPreferences((current) => ({ ...current, perTenantVolume: { ...current.perTenantVolume, [stream.tenantId]: Number(event.target.value) / 100 } }))} style={{ flex: 1 }} />
                  {Math.round(tenantVolume * 100)}%
                </label>
              )}
            </article>
          );
        })}
      </section>

      <p style={{ marginTop: 12, color: '#94a3b8', fontSize: 11 }}>{status}</p>
      {micTranscript && <p style={{ marginTop: 4, color: '#c4b5fd', fontSize: 11 }}>Last PTT: “{micTranscript}”</p>}
    </main>
  );
}

const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#cbd5e1' };
const selectStyle: React.CSSProperties = { border: '1px solid #ffffff22', borderRadius: 8, background: '#08111f', color: '#f8fafc', padding: '7px 9px' };
const smallButtonStyle: React.CSSProperties = { border: '1px solid #ffffff22', borderRadius: 7, background: '#ffffff0c', color: '#e2e8f0', padding: '6px 8px', cursor: 'pointer' };
function buttonStyle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? '#22d3ee88' : '#ffffff22'}`,
    borderRadius: 9,
    background: active ? '#164e63' : '#ffffff0c',
    color: active ? '#cffafe' : '#f8fafc',
    padding: '8px 11px',
    fontWeight: 800,
    cursor: 'pointer',
  };
}
