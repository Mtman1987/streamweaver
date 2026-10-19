'use client';

import { DiscordSayRecognition } from '@/services/discord-say-recognition';

import { getSpeechRecognitionConstructor } from '@/services/microphone-recognition';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_TTS_VOICE } from '@/lib/tts-voices';
import { captureSpeechChat } from '@/services/speech-chat-capture';
import { useLoungeBroadcastVolume } from '@/lib/lounge-broadcast-volume';

type VoiceOption = { id: string; label: string };

type VoiceIdentity = { discordUserId: string; discordUsername: string };

export default function SayPlayer() {
  const playing = useRef(false);
  const playingAudioRef = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<Array<{ id: number; audioUrl: string; text?: string; addedAt?: string }>>([]);
  const knownIds = useRef<Set<number>>(new Set());
  const lastSeenId = useRef(0);
  const ready = useRef(false);
  const needsLiveResync = useRef(false);
  const recognitionRef = useRef<ReturnType<typeof captureSpeechChat> | null>(null);
  const pendingCaptureId = useRef<string | null>(null);
  const [active, setActive] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [volume, setVolume] = useState(0.6);
  const stellaLevel = useLoungeBroadcastVolume('stella');
  const broadcastSource = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('placement') === 'lounge';
  useEffect(() => {
    if (broadcastSource && tenantId === 'spacemountainlive' && stellaLevel !== null && playingAudioRef.current) {
      playingAudioRef.current.volume = stellaLevel;
    }
  }, [broadcastSource, tenantId, stellaLevel]);
  const [voice, setVoice] = useState('');
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([{ id: '', label: 'Default voice' }]);
  const [identity, setIdentity] = useState<VoiceIdentity | null>(null);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [status, setStatus] = useState('Activate this public TTS browser source to hear shared chat audio.');
  const [voiceRoute, setVoiceRoute] = useState<{ inVoice: boolean; channelName?: string } | null>(null);
  const [voiceRouteError, setVoiceRouteError] = useState('');
  const [micPending, setMicPending] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [micTranscript, setMicTranscript] = useState('');
  const [transcriptSending, setTranscriptSending] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<Array<{ id: number; text: string; addedAt?: string }>>([]);
  const [postingAs, setPostingAs] = useState('');
  const [botTtsEnabled, setBotTtsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextTenantId = params.get('tenantId') || '';
    const controlToken = params.get('controlToken') || '';
    setTenantId(nextTenantId);
    if (broadcastSource && nextTenantId === 'spacemountainlive') setActive(true);
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
        if (Array.isArray(payload.voices)) {
          setVoiceOptions([{ id: '', label: `Default voice (${payload.defaultVoice || 'free Kokoro'})` }, ...payload.voices.map((item: any) => ({ id: String(item.id), label: `${String(item.label)} — ${String(item.provider)}` }))]);
        }
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

  useEffect(() => {
    if (!broadcastSource) return;
    const unlock = () => {
      const audio = playingAudioRef.current;
      if (!audio) return;
      audio.muted = false;
      if (audio.paused) void audio.play().catch(() => {});
    };
    window.addEventListener('streamweaver:lounge-audio-unlock', unlock);
    return () => window.removeEventListener('streamweaver:lounge-audio-unlock', unlock);
  }, [broadcastSource]);

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
      const label = voiceOptions.find((item) => item.id === payload.voice)?.label || 'default voice';
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
    if (Array.isArray(result.history)) {
      setHistoryEntries(result.history
        .filter((item: any) => Number(item?.id || 0) > 0 && typeof item?.text === 'string' && item.text.trim())
        .map((item: any) => ({ id: Number(item.id), text: String(item.text).trim(), addedAt: typeof item.addedAt === 'string' ? item.addedAt : undefined }))
        .slice(-50));
    }
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
            const queueItem = {
              id,
              audioUrl: String(item.audioUrl),
              ...(typeof item.text === 'string' && item.text.trim() ? { text: item.text.trim() } : {}),
              ...(typeof item.addedAt === 'string' ? { addedAt: item.addedAt } : {}),
            };
            queue.current.push(queueItem);
            if (queueItem.text) {
              setHistoryEntries((current) => current.some((entry) => entry.id === id)
                ? current
                : [...current, { id, text: queueItem.text!, addedAt: queueItem.addedAt }].slice(-50));
            }
          }
        }
        if (playing.current || !queue.current.length) return;
        const next = queue.current.shift();
        if (!next) return;
        playing.current = true;
        const audio = new Audio(next.audioUrl);
        playingAudioRef.current = audio;
        audio.volume = broadcastSource && tenantId === 'spacemountainlive' ? (stellaLevel ?? volume) : volume;
        const finish = (message: string) => {
          lastSeenId.current = Math.max(lastSeenId.current, Number(next.id || 0));
          try { localStorage.setItem(`streamweaver-say-last-${tenantId || 'global'}`, String(lastSeenId.current)); } catch {}
          playing.current = false;
          if (playingAudioRef.current === audio) playingAudioRef.current = null;
          setStatus(message);
        };
        audio.onended = () => finish('Listening for new public TTS…');
        audio.onerror = () => finish('That audio failed. Listening for the next message…');
        setStatus('Speaking…');
        void audio.play().catch((error) => {
          playing.current = false;
          if (playingAudioRef.current === audio) playingAudioRef.current = null;
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
  }, [active, resetCursor, syncToLatest, tenantId, volume, broadcastSource, stellaLevel]);


  useEffect(() => {
    recognitionRef.current?.cancel();
    recognitionRef.current = null;
    setMicActive(false);
    return () => {
      recognitionRef.current?.cancel();
      recognitionRef.current = null;
    };
  }, [tenantId]);

  useEffect(() => {
    let disposed = false;
    const probe = async () => {
      try {
        const response = await fetch('/api/say/voice', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Could not check Discord VC.');
        if (!disposed) { setVoiceRoute(body.data || body); setVoiceRouteError(''); }
      } catch (error) { if (!disposed) { setVoiceRoute({ inVoice: false }); setVoiceRouteError(error instanceof Error ? error.message : String(error)); } }
    };
    void probe();
    const timer = setInterval(() => void probe(), 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  function toggleMic() {
    if (recognitionRef.current) { recognitionRef.current.stop(); return; }
    if (!voiceRoute) { setStatus(voiceRouteError || 'Checking your Discord voice connection…'); return; }
    const SpeechRecognition = voiceRoute.inVoice ? DiscordSayRecognition : getSpeechRecognitionConstructor();
    if (!SpeechRecognition) return setStatus('Speech recognition is not supported in this browser.');
    const recognition = new SpeechRecognition();
    const captureId = crypto.randomUUID();
    const capture = captureSpeechChat(recognition, {
      preview: setMicTranscript,
      ready: () => { setMicPending(false); setMicActive(true); setStatus(voiceRoute.inVoice ? "Discord listener ready. Speak in VC, then tap Finish (maximum 15 seconds)." : "Microphone ready. Speak, then tap Finish (maximum 15 seconds on mobile)."); },
      processing: () => { setMicActive(false); setStatus("Transcribing microphone clip…"); },
      complete: async (transcript) => {
        recognitionRef.current = null;
        setMicActive(false); setMicPending(false);
        if (!transcript) { setStatus('No completed speech heard. Try again or type below.'); return; }
        pendingCaptureId.current = captureId;
        setMicTranscript(transcript);
        setStatus('Transcript ready. Correct any recognition errors, then send it to chat.');
      },
      error: (message) => {
        recognitionRef.current = null;
        setMicActive(false); setMicPending(false);
        setStatus(message || 'Microphone recognition failed. Check browser microphone permission.');
      },
    });
    setMicPending(true);
    recognitionRef.current = capture;
    try { recognition.start(); } catch {
      capture.cancel();
      recognitionRef.current = null;
      setMicActive(false); setMicPending(false);
      setStatus('Could not start microphone recognition. Try again.');
      return;
    }
    setStatus(voiceRoute.inVoice ? 'Joining Discord VC… speak when the listener is ready.' : 'Starting microphone… speak when it is ready.');
  }

  async function sendTranscript() {
    const text = micTranscript.trim();
    if (!text) {
      setStatus('Speak first or type a message into the transcript box.');
      return;
    }
    if (transcriptSending) return;
    setTranscriptSending(true);
    try {
      const response = await fetch('/api/say/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          ...(pendingCaptureId.current ? { captureId: pendingCaptureId.current } : {}),
          streamKey: tenantId || undefined,
          voice: voice || undefined,
        }),
      });
      const result = await response.json().catch(() => null);
      const payload = result?.data || result || {};
      if (!response.ok || result?.ok === false) throw new Error(result?.error || payload?.error || 'Chat post failed');
      if (payload?.identity?.username) setPostingAs(payload.identity.username);
      pendingCaptureId.current = null;
      setMicTranscript('');
      setStatus('Sent to the selected public chat. Its existing public TTS route will handle playback.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setTranscriptSending(false);
    }
  }

  const sourceLabel = tenantId || 'global public TTS';
  return (
    <main style={{ minHeight: '100vh', background: '#090b12', color: '#f4f6ff', fontFamily: 'system-ui,sans-serif', padding: 20 }}>
      <section style={{ width: 'min(880px,100%)', margin: '0 auto', border: '1px solid #293148', borderRadius: 18, background: '#111522', padding: 20, display: 'grid', gap: 16 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><h1 style={{ margin: 0, fontSize: 23 }}>🔊 Public TTS</h1><p style={{ color: '#aeb7ce', margin: '6px 0 0' }}>One browser-source voice lane for Discord, Twitch, Kick and other public chat adapters. Private TTS stays separate.</p></div>
          <strong style={{ color: active ? '#8ef0b1' : '#ffd28a' }}>{active ? '● TTS PLAYBACK ACTIVE' : '○ AUDIO READY'}</strong>
        </header>
        <div style={{ padding: 12, borderRadius: 11, background: '#0b0e17', border: '1px solid #293148' }}><small style={{ color: '#8590aa' }}>PUBLIC STREAM</small><div style={{ fontWeight: 800, marginTop: 4 }}>{sourceLabel}</div></div>
        {botTtsEnabled !== null ? <div style={{ padding: 12, borderRadius: 11, background: '#0b0e17', border: '1px solid #293148' }}><strong>Bot TTS: {botTtsEnabled ? 'ON' : 'OFF'}</strong><div style={{ color: '#aeb7ce', marginTop: 4 }}>{botTtsEnabled ? 'Future public replies from this bot will speak through this same TTS stream.' : 'Future replies from this bot stay silent.'}</div></div> : null}
        <p style={{ margin: 0, minHeight: 24, color: '#cbd2e4' }}>{status}</p>
        {!active ? <button onClick={() => setActive(true)} style={{ padding: '13px 18px', borderRadius: 10, border: '1px solid #4fa476', background: '#153424', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>▶ Activate public TTS audio</button> : null}
        <label style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ width: 90 }}>Volume</strong><input type="range" min="0" max="100" value={Math.round(volume * 100)} onChange={(event) => updateVolume(Number(event.target.value) / 100)} style={{ flex: '1 1 260px' }} /><span>{Math.round(volume * 100)}%</span></label>
        <label style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ width: 90 }}>My voice</strong><select value={voice} disabled={!identity || voiceSaving} onChange={(event) => void updateVoice(event.target.value)} style={{ flex: '1 1 360px', padding: 9, borderRadius: 8, border: '1px solid #3a4259', background: '#0b0e17', color: '#fff' }}>{voiceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <p style={{ margin: '-8px 0 0 102px', color: '#8791aa', fontSize: 13 }}>{identity ? `Saved for ${identity.discordUsername || identity.discordUserId}. Everyone hears your selected voice when your public TTS is triggered.` : `No sign-in is needed to listen. Sign-in is only for saving a personal voice; otherwise ${'Kokoro Heart'} is used.`}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={toggleMic} style={{ padding: '10px 14px', borderRadius: 9, border: '1px solid #4fa476', background: micActive ? '#4a1717' : '#153424', color: '#fff', cursor: 'pointer' }}>{micActive ? '🔴 Finish recording' : micPending ? 'Connecting listener…' : '🎤 Speak to Chat'}</button>
          <button type="button" onClick={sendTranscript} disabled={transcriptSending || !micTranscript.trim()} style={{ padding: '10px 14px', borderRadius: 9, border: '1px solid #4fa476', background: transcriptSending ? '#293148' : '#153424', color: '#fff', fontWeight: 800, opacity: transcriptSending || !micTranscript.trim() ? 0.65 : 1, cursor: transcriptSending ? 'wait' : 'pointer' }}>{transcriptSending ? 'Sending…' : '➤ Send to chat & speak'}</button>
          <button type="button" onClick={() => { setMicTranscript(''); pendingCaptureId.current = null; setStatus('Transcript cleared.'); }} disabled={!micTranscript && !pendingCaptureId.current} style={{ padding: '10px 14px', borderRadius: 9, border: '1px solid #3a4259', background: '#171b29', color: '#fff', cursor: 'pointer' }}>Clear transcript</button>
          <button type="button" onClick={resetCursor} disabled={!active} style={{ padding: '10px 14px', borderRadius: 9, border: '1px solid #3a4259', background: '#171b29', color: '#fff', cursor: active ? 'pointer' : 'default' }}>Reset listener</button>
        </div>
        <label style={{ display: 'grid', gap: 8 }}>
          <strong>Message to post (editable transcript)</strong>
          <textarea value={micTranscript} onChange={(event) => setMicTranscript(event.target.value)} rows={3} maxLength={500} placeholder="Speak to fill this in, correct any mistakes, or type your message directly." style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: '#0b0e17', color: '#f4f6ff', border: '1px solid #3a4259', borderRadius: 9, padding: 12, lineHeight: 1.45, font: 'inherit' }} />
        </label>
        <p style={{ margin: 0, color: '#aeb7ce', fontSize: 13 }}>{voiceRoute?.inVoice ? 'Voice input: Discord VC' + (voiceRoute.channelName ? ' — ' + voiceRoute.channelName : '') : voiceRoute ? 'Voice input: device microphone' : voiceRouteError || 'Checking voice input…'}</p>
        {postingAs ? <p style={{ margin: 0, color: '#8ef0b1', fontSize: 13 }}>Posting as verified user: {postingAs}</p> : null}
        <p style={{ margin: 0, color: '#8791aa', fontSize: 13 }}>Public mode: the final text is posted through the selected Twitch or Discord adapter. It is not published until you press Send.</p>
        <section style={{ border: '1px solid #293148', borderRadius: 12, background: '#0b0e17', padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <strong>Recent public TTS history</strong>
            <span style={{ color: '#8791aa', fontSize: 12 }}>Newest 50</span>
          </div>
          <div aria-live="polite" style={{ display: 'grid', gap: 8, maxHeight: 280, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            {historyEntries.length ? historyEntries.slice().reverse().map((item) => (
              <article key={item.id} style={{ border: '1px solid #293148', borderRadius: 8, padding: 10, background: '#111522' }}>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{item.text}</p>
                {item.addedAt ? <small style={{ display: 'block', marginTop: 6, color: '#7f899f' }}>{new Date(item.addedAt).toLocaleTimeString()}</small> : null}
              </article>
            )) : <p style={{ margin: 0, color: '#8791aa' }}>Spoken messages appear here when their source includes text.</p>}
          </div>
        </section>
        <p style={{ margin: 0, color: '#8791aa', fontSize: 13 }}>HearMeOut/LiveKit is optional. This public TTS page does not create or join a LiveKit room; an active HearMeOut room may consume TTS separately when explicitly configured.</p>
      </section>
    </main>
  );
}
