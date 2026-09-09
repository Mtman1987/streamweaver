'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_TTS_VOICE, TTS_VOICE_OPTIONS } from '@/lib/tts-voices';

const VOICE_OPTIONS = [
  { id: '', label: 'Default voice' },
  ...TTS_VOICE_OPTIONS.map((voice) => ({ id: voice.id, label: `${voice.label} — ${voice.providerLabel}` })),
];

type VoiceIdentity = { discordUserId: string; discordUsername: string };

export default function SayPlayer() {
  const playing = useRef(false);
  const queue = useRef<Array<{ id: number; audioUrl: string }>>([]);
  const knownIds = useRef<Set<number>>(new Set());
  const lastSeenId = useRef(0);
  const ready = useRef(false);
  const needsLiveResync = useRef(false);
  const recognitionRef = useRef<any>(null);
  const [active, setActive] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [volume, setVolume] = useState(0.6);
  const [voice, setVoice] = useState('');
  const [identity, setIdentity] = useState<VoiceIdentity | null>(null);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [status, setStatus] = useState('Activate this public TTS browser source to hear shared chat audio.');
  const [micActive, setMicActive] = useState(false);
  const [micTranscript, setMicTranscript] = useState('');
  const [postingAs, setPostingAs] = useState('');
  const [botTtsEnabled, setBotTtsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextTenantId = params.get('tenantId') || '';
    const controlToken = params.get('controlToken') || '';
    setTenantId(nextTenantId);
    try {
      lastSeenId.current = Number(localStorage.getItem(`streamweaver-say-last-${nextTenantId || 'global'}`) || 0);
      const savedVolume = Number(localStorage.getItem('streamweaver-say-volume') || '');
      if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) setVolume(savedVolume);
    } catch {}

    fetch('/api/say/preferences', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        const payload = result?.data || result || {};
        if (!response.ok || result?.ok === false) return;
        setIdentity(payload.identity || null);
        setPostingAs(String(payload.identity?.discordUsername || ''));
        setVoice(String(payload.voice || ''));
      })
      .catch(() => {});

    if (controlToken) {
      setStatus('Updating this bot speaker…');
      fetch('/api/discord/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ token: controlToken, action: 'tts' }),
      }).then(async (response) => {
        const result = await response.json().catch(() => null);
        const payload = result?.data || result || {};
        if (!response.ok || result?.ok === false) throw new Error(result?.error || payload?.error || 'Bot TTS control failed');
        if (typeof payload.enabled === 'boolean') setBotTtsEnabled(payload.enabled);
        if (payload.streamKey) setTenantId(String(payload.streamKey));
        setStatus(payload.message || 'Bot TTS updated.');
      }).catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
    }
  }, []);

  useEffect(() => {
    fetch('/api/say/chat', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        const payload = result?.data || result || {};
        if (response.ok && payload?.identity?.username) setPostingAs(payload.identity.username);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) return;
    const streamKey = tenantId || 'global';
    const heartbeat = () => fetch('/api/tts/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: streamKey, kind: 'say', scope: 'say' }),
      keepalive: true,
    }).catch(() => {});
    heartbeat();
    const interval = window.setInterval(heartbeat, 10_000);
    return () => window.clearInterval(interval);
  }, [active, tenantId]);

  function updateVolume(next: number) {
    const value = Math.max(0, Math.min(1, next));
    setVolume(value);
    try { localStorage.setItem('streamweaver-say-volume', String(value)); } catch {}
  }

  async function updateVoice(nextVoice: string) {
    setVoice(nextVoice);
    if (!identity) return setStatus('Sign in with your linked SPMT/Discord identity to save your personal voice.');
    setVoiceSaving(true);
    try {
      const response = await fetch('/api/say/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: nextVoice }),
      });
      const result = await response.json().catch(() => null);
      const payload = result?.data || result || {};
      if (!response.ok || result?.ok === false) throw new Error(result?.error || payload?.error || 'Could not save voice');
      setVoice(String(payload.voice || ''));
      const label = TTS_VOICE_OPTIONS.find((item) => item.id === payload.voice)?.label || 'default voice';
      setStatus(`Saved. Your public messages will be spoken with ${label}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setVoiceSaving(false);
    }
  }

  const syncToLatest = useCallback(async (message = 'Listening for new public TTS…') => {
    queue.current = [];
    knownIds.current.clear();
    ready.current = false;
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    params.set('latest', '1');
    const response = await fetch(`/api/say/next?${params.toString()}`, { cache: 'no-store' });
    const result = await response.json();
    lastSeenId.current = Math.max(0, Number(result.latestId || 0));
    try { localStorage.setItem(`streamweaver-say-last-${tenantId || 'global'}`, String(lastSeenId.current)); } catch {}
    ready.current = true;
    needsLiveResync.current = false;
    setStatus(message);
  }, [tenantId]);

  const resetCursor = useCallback(() => void syncToLatest('Skipped old audio. Listening live from now…'), [syncToLatest]);

  useEffect(() => {
    if (!active) return;
    void syncToLatest();
  }, [active, syncToLatest]);

  useEffect(() => {
    if (!active) return;
    const poll = window.setInterval(async () => {
      try {
        if (!ready.current) return;
        if (needsLiveResync.current) return void await syncToLatest('Reconnected. Listening live…');
        const params = new URLSearchParams();
        if (tenantId) params.set('tenantId', tenantId);
        params.set('after', String(lastSeenId.current));
        const result = await (await fetch(`/api/say/next?${params.toString()}`, { cache: 'no-store' })).json();
        if (!result?.items?.length && Number(result?.latestId || 0) > 0 && Number(result.latestId) < lastSeenId.current) return resetCursor();
        if (Array.isArray(result?.items)) for (const item of result.items) {
          const id = Number(item?.id || 0);
          if (id && item?.audioUrl && !knownIds.current.has(id)) {
            knownIds.current.add(id);
            queue.current.push(item);
          }
        }
        if (playing.current || !queue.current.length) return;
        const next = queue.current.shift();
        if (!next) return;
        playing.current = true;
        const audio = new Audio(next.audioUrl);
        audio.volume = volume;
        const finish = (message: string) => {
          lastSeenId.current = Math.max(lastSeenId.current, Number(next.id || 0));
          try { localStorage.setItem(`streamweaver-say-last-${tenantId || 'global'}`, String(lastSeenId.current)); } catch {}
          playing.current = false;
          setStatus(message);
        };
        audio.onended = () => finish('Listening for new public TTS…');
        audio.onerror = () => finish('That audio failed. Listening for the next message…');
        setStatus('Speaking…');
        void audio.play().catch((error) => {
          playing.current = false;
          knownIds.current.delete(Number(next.id || 0));
          queue.current.unshift(next);
          setStatus(`Browser blocked audio: ${error?.message || 'activate audio and try again'}`);
        });
      } catch {
        needsLiveResync.current = true;
        setStatus('Connection interrupted. Reconnecting…');
      }
    }, 500);
    return () => window.clearInterval(poll);
  }, [active, resetCursor, syncToLatest, tenantId, volume]);

  function toggleMic() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return setStatus('Speech recognition is not supported in this browser.');
    if (micActive) {
      recognitionRef.current?.stop();
      return setMicActive(false);
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;
    recognition.onresult = async (event: any) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
      if (!transcript) return;
      setMicTranscript(transcript);
      try {
        const response = await fetch('/api/say/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: transcript, streamKey: tenantId || undefined, voice: voice || undefined }),
        });
        const result = await response.json().catch(() => null);
        const payload = result?.data || result || {};
        if (!response.ok || result?.ok === false) throw new Error(result?.error || payload?.error || 'Chat post failed');
        if (payload?.identity?.username) setPostingAs(payload.identity.username);
        setStatus('Posted to chat and queued on this same public TTS browser source.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    };
    recognition.onerror = () => { setMicActive(false); setStatus('Mic error. Try again.'); };
    recognition.onend = () => setMicActive(false);
    recognition.start();
    setMicActive(true);
    setStatus('Listening to your mic…');
  }

  const sourceLabel = tenantId || 'global public TTS';
  return (
    <main style={{ minHeight: '100vh', background: '#090b12', color: '#f4f6ff', fontFamily: 'system-ui,sans-serif', padding: 20 }}>
      <section style={{ width: 'min(880px,100%)', margin: '0 auto', border: '1px solid #293148', borderRadius: 18, background: '#111522', padding: 20, display: 'grid', gap: 16 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><h1 style={{ margin: 0, fontSize: 23 }}>🔊 Public TTS</h1><p style={{ color: '#aeb7ce', margin: '6px 0 0' }}>One browser-source voice lane for Discord, Twitch, Kick and other public chat adapters. Private TTS stays separate.</p></div>
          <strong style={{ color: active ? '#8ef0b1' : '#ffd28a' }}>{active ? '● LISTENING' : '○ AUDIO READY'}</strong>
        </header>
        <div style={{ padding: 12, borderRadius: 11, background: '#0b0e17', border: '1px solid #293148' }}><small style={{ color: '#8590aa' }}>PUBLIC STREAM</small><div style={{ fontWeight: 800, marginTop: 4 }}>{sourceLabel}</div></div>
        {botTtsEnabled !== null ? <div style={{ padding: 12, borderRadius: 11, background: '#0b0e17', border: '1px solid #293148' }}><strong>Bot TTS: {botTtsEnabled ? 'ON' : 'OFF'}</strong><div style={{ color: '#aeb7ce', marginTop: 4 }}>{botTtsEnabled ? 'Future public replies from this bot will speak through this same TTS stream.' : 'Future replies from this bot stay silent.'}</div></div> : null}
        <p style={{ margin: 0, minHeight: 24, color: '#cbd2e4' }}>{status}</p>
        {!active ? <button onClick={() => setActive(true)} style={{ padding: '13px 18px', borderRadius: 10, border: '1px solid #4fa476', background: '#153424', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>▶ Activate public TTS audio</button> : null}
        <label style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ width: 90 }}>Volume</strong><input type="range" min="0" max="100" value={Math.round(volume * 100)} onChange={(event) => updateVolume(Number(event.target.value) / 100)} style={{ flex: '1 1 260px' }} /><span>{Math.round(volume * 100)}%</span></label>
        <label style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ width: 90 }}>My voice</strong><select value={voice} disabled={!identity || voiceSaving} onChange={(event) => void updateVoice(event.target.value)} style={{ flex: '1 1 360px', padding: 9, borderRadius: 8, border: '1px solid #3a4259', background: '#0b0e17', color: '#fff' }}>{VOICE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <p style={{ margin: '-8px 0 0 102px', color: '#8791aa', fontSize: 13 }}>{identity ? `Saved for ${identity.discordUsername || identity.discordUserId}. Everyone hears your selected voice when your public TTS is triggered.` : `Sign in with your linked identity to choose a voice. Unset users use ${TTS_VOICE_OPTIONS.find((item) => item.id === DEFAULT_TTS_VOICE)?.label || 'the default voice'}.`}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" onClick={toggleMic} style={{ padding: '10px 14px', borderRadius: 9, border: '1px solid #4fa476', background: micActive ? '#4a1717' : '#153424', color: '#fff', cursor: 'pointer' }}>{micActive ? '🔴 Listening…' : '🎤 Speak to Chat'}</button><button type="button" onClick={resetCursor} disabled={!active} style={{ padding: '10px 14px', borderRadius: 9, border: '1px solid #3a4259', background: '#171b29', color: '#fff', cursor: active ? 'pointer' : 'default' }}>Reset listener</button></div>
        {postingAs ? <p style={{ margin: 0, color: '#8ef0b1', fontSize: 13 }}>Posting as verified user: {postingAs}</p> : null}
        {micTranscript ? <p style={{ margin: 0, color: '#aeb7ce', fontSize: 13 }}>Last voice input: “{micTranscript}”</p> : null}
        <p style={{ margin: 0, color: '#8791aa', fontSize: 13 }}>HearMeOut/LiveKit is optional. This public TTS page does not create or join a LiveKit room; an active HearMeOut room may consume TTS separately when explicitly configured.</p>
      </section>
    </main>
  );
}
