'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const VOICE_OPTIONS = [
  { id: '', label: 'Default (server setting)' },
  { id: 'openai:nova', label: 'Nova (OpenAI) — bright female' },
  { id: 'openai:shimmer', label: 'Shimmer (OpenAI) — clear female' },
  { id: 'openai:alloy', label: 'Alloy (OpenAI) — neutral' },
  { id: 'openai:echo', label: 'Echo (OpenAI) — warm male' },
  { id: 'openai:fable', label: 'Fable (OpenAI) — expressive male' },
  { id: 'openai:onyx', label: 'Onyx (OpenAI) — deep male' },
  { id: 'edenai:google:FEMALE', label: 'Google Female (EdenAI)' },
  { id: 'edenai:google:MALE', label: 'Google Male (EdenAI)' },
  { id: 'edenai:microsoft:FEMALE', label: 'Microsoft Female (EdenAI)' },
  { id: 'edenai:microsoft:MALE', label: 'Microsoft Male (EdenAI)' },
  { id: 'edenai:amazon:FEMALE', label: 'Amazon Female (EdenAI)' },
  { id: 'edenai:amazon:MALE', label: 'Amazon Male (EdenAI)' },
];

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
  const [status, setStatus] = useState('Click to unlock browser audio.');
  const [micActive, setMicActive] = useState(false);
  const [micTranscript, setMicTranscript] = useState('');

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
    try {
      const savedVoice = localStorage.getItem('streamweaver-say-voice') || '';
      if (savedVoice) setVoice(savedVoice);
    } catch {}
  }, []);

  function updateVolume(nextVolume: number) {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    setVolume(clamped);
    try { localStorage.setItem('streamweaver-say-volume', String(clamped)); } catch {}
  }

  function updateVoice(nextVoice: string) {
    setVoice(nextVoice);
    try { localStorage.setItem('streamweaver-say-voice', nextVoice); } catch {}
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
    try { localStorage.setItem(`streamweaver-say-last-${tenantId || 'global'}`, String(lastSeenId.current)); } catch {}
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
        const res = await fetch(`/api/say/next?${params.toString()}`);
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
          try { localStorage.setItem(`streamweaver-say-last-${tenantId || 'global'}`, String(lastSeenId.current)); } catch {}
        };
        audio.onended = () => { markPlayed(); playing.current = false; setStatus('Listening for messages...'); };
        audio.onerror = () => { markPlayed(); playing.current = false; setStatus('Audio failed. Waiting for next message...'); };
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

  function toggleMic() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('Speech recognition not supported in this browser.');
      return;
    }

    if (micActive) {
      recognitionRef.current?.stop();
      setMicActive(false);
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
      setStatus(`Sending: "${transcript}"`);

      // Queue as TTS so the channel hears it
      const body: any = { text: transcript };
      if (tenantId) body.tenantId = tenantId;
      if (voice) body.voice = voice;
      await fetch('/api/say/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});

      // Also post to chat so it appears as text
      await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: transcript, platform: 'discord', channelId: tenantId?.replace('discord:', '') }),
      }).catch(() => {});

      setStatus('Listening for messages...');
    };

    recognition.onerror = () => { setMicActive(false); setStatus('Mic error. Try again.'); };
    recognition.onend = () => setMicActive(false);

    recognition.start();
    setMicActive(true);
    setStatus('Listening to mic...');
  }

  if (!active) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', cursor: 'pointer' }} onClick={start}>
        <h1 style={{ fontSize: '6rem', color: '#0f0', fontFamily: 'monospace', textAlign: 'center' }}>CLICK HERE TO HEAR TTS</h1>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', color: '#0f0', fontFamily: 'monospace', textAlign: 'center', padding: '1rem' }}>
      <p style={{ fontSize: '2rem' }}>Say Player Active</p>
      <p style={{ fontSize: '1rem', color: '#9f9' }}>{status}</p>

      {/* Volume */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1rem', color: '#9f9' }}>
        Volume
        <input
          type="range" min="0" max="100"
          value={Math.round(volume * 100)}
          onChange={(e) => updateVolume(Number(e.target.value) / 100)}
          style={{ width: 'min(60vw, 280px)' }}
        />
        <span style={{ minWidth: '3ch' }}>{Math.round(volume * 100)}%</span>
      </label>

      {/* Voice selector */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1rem', color: '#9f9' }}>
        Voice
        <select
          value={voice}
          onChange={(e) => updateVoice(e.target.value)}
          style={{ background: '#020', color: '#0f0', border: '1px solid #0f0', padding: '0.25rem 0.5rem', fontFamily: 'monospace', fontSize: '0.9rem', width: 'min(60vw, 320px)' }}
        >
          {VOICE_OPTIONS.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      </label>

      {/* Mic button */}
      <button
        onClick={toggleMic}
        style={{
          border: `2px solid ${micActive ? '#f00' : '#0f0'}`,
          background: micActive ? '#200' : '#020',
          color: micActive ? '#f00' : '#0f0',
          padding: '0.75rem 2rem',
          fontFamily: 'monospace',
          fontSize: '1.2rem',
          cursor: 'pointer',
          borderRadius: '4px',
        }}
      >
        {micActive ? '🔴 Stop Mic' : '🎤 Speak to Chat'}
      </button>
      {micTranscript && (
        <p style={{ fontSize: '0.85rem', color: '#9f9', maxWidth: '80vw' }}>Last: "{micTranscript}"</p>
      )}

      <button
        onClick={resetCursor}
        style={{ border: '1px solid #0f0', background: '#020', color: '#0f0', padding: '0.5rem 1rem', fontFamily: 'monospace', cursor: 'pointer' }}
      >
        Reset listener
      </button>
    </div>
  );
}
