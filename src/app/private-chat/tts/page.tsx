'use client';

import { useEffect, useRef, useState } from 'react';
import { TTS_VOICE_OPTIONS, normalizeTtsVoice } from '@/lib/tts-voices';

const VOICE_OPTIONS = [
  { id: '', label: 'Tenant default (lifelike Eden voice)' },
  ...TTS_VOICE_OPTIONS.map((voice) => ({
    id: voice.id,
    label: `${voice.label} — ${voice.providerLabel}`,
  })),
];

type PreviewEmbed = {
  author?: { name?: string; icon_url?: string };
  title?: string;
  description?: string;
  thumbnail?: { url?: string };
  image?: { url?: string };
  footer?: { text?: string; icon_url?: string };
  fields?: Array<{ name?: string; value?: string; inline?: boolean }>;
};

type PrivateTtsItem = {
  cursor: number;
  text: string;
  question?: string;
  timestamp?: string;
  audioDataUris: string[];
};

function buildSyntheticPreview(input: {
  botName: string;
  text: string;
  question?: string;
  mediaUrl?: string;
}): PreviewEmbed {
  return {
    author: { name: input.botName || 'Athena' },
    description: input.text,
    ...(input.mediaUrl ? { image: { url: input.mediaUrl } } : {}),
    fields: input.question
      ? [{ name: 'Question', value: input.question, inline: false }]
      : [],
  };
}

export default function PrivateDmTtsPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const cursorRef = useRef(0);
  const pollingRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const tokenRef = useRef('');

  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Opening private Athena TTS…');
  const [volume, setVolume] = useState(0.6);
  const [voice, setVoice] = useState('');
  const [preview, setPreview] = useState<PreviewEmbed | null>(null);
  const [botName, setBotName] = useState('Athena');
  const [mediaUrl, setMediaUrl] = useState('');
  const [micActive, setMicActive] = useState(false);
  const [micTranscript, setMicTranscript] = useState('');

  useEffect(() => {
    try {
      const savedVolume = Number(localStorage.getItem('streamweaver-private-dm-tts-volume') || '');
      if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) setVolume(savedVolume);
    } catch {}
    try {
      const savedVoice = localStorage.getItem('streamweaver-private-dm-tts-voice') || '';
      if (savedVoice) setVoice(normalizeTtsVoice(savedVoice));
    } catch {}
  }, []);

  function updateVolume(nextVolume: number) {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    setVolume(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
    try { localStorage.setItem('streamweaver-private-dm-tts-volume', String(clamped)); } catch {}
  }

  function updateVoice(nextVoice: string) {
    setVoice(nextVoice);
    try { localStorage.setItem('streamweaver-private-dm-tts-voice', nextVoice); } catch {}
  }

  async function playNext(): Promise<void> {
    if (audioRef.current && !audioRef.current.ended && !audioRef.current.paused) return;
    const audioUrl = audioQueueRef.current.shift();
    if (!audioUrl) {
      setStatus(enabled ? 'Listening for Athena replies…' : 'Private Athena TTS is off.');
      return;
    }

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.volume = volume;
    audio.preload = 'auto';
    audio.onended = () => {
      audioRef.current = null;
      void playNext();
    };
    audio.onerror = () => {
      audioRef.current = null;
      setStatus('One TTS clip failed. Continuing with the next Athena reply…');
      void playNext();
    };
    try {
      setStatus('Athena is speaking…');
      await audio.play();
    } catch (error: any) {
      audioQueueRef.current.unshift(audioUrl);
      audioRef.current = null;
      setStatus(`Browser blocked autoplay. Tap “Play / Resume” to continue. ${error?.message || ''}`.trim());
    }
  }

  function enqueueAudio(urls: unknown) {
    if (!Array.isArray(urls)) return;
    for (const value of urls) {
      if (typeof value === 'string' && value.startsWith('data:audio')) {
        audioQueueRef.current.push(value);
      }
    }
    void playNext();
  }

  async function postControl(payload: Record<string, unknown>, keepalive = false) {
    const response = await fetch('/api/private-chat/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      keepalive,
      body: JSON.stringify({
        token: tokenRef.current,
        action: 'tts',
        voice: voice || undefined,
        ...payload,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || 'Private TTS request failed.');
    }
    return data;
  }

  useEffect(() => {
    tokenRef.current = new URLSearchParams(window.location.search).get('k') || '';
    if (!tokenRef.current) {
      setStatus('This private TTS link is missing its signed Discord token.');
      return;
    }

    let cancelled = false;
    const start = async () => {
      try {
        const data = await postControl({ mode: 'toggle' });
        if (cancelled) return;
        const isEnabled = data.ttsEnabled === true;
        setEnabled(isEnabled);
        sessionStartedRef.current = isEnabled;
        setBotName(String(data.botName || 'Athena'));
        setMediaUrl(String(data.mediaUrl || ''));
        cursorRef.current = Math.max(0, Number(data.cursor || 0));
        if (data.currentEmbed && typeof data.currentEmbed === 'object') {
          setPreview(data.currentEmbed as PreviewEmbed);
        } else if (data.currentText) {
          setPreview(buildSyntheticPreview({
            botName: String(data.botName || 'Athena'),
            text: String(data.currentText),
            mediaUrl: String(data.mediaUrl || ''),
          }));
        }
        if (!isEnabled) {
          setStatus('Private Athena TTS was already running, so this click turned it OFF. You can close this page.');
          return;
        }
        setStatus('Private Athena TTS is ON. Reading this reply, then listening for new Athena replies…');
        enqueueAudio(data.audioDataUris);
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
      }
    };
    void start();

    return () => { cancelled = true; };
    // Voice is intentionally sampled per request rather than restarting the session when changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled || !tokenRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled || pollingRef.current) return;
      pollingRef.current = true;
      try {
        const data = await postControl({ mode: 'poll', after: cursorRef.current });
        if (cancelled) return;
        if (data.ttsEnabled !== true) {
          setEnabled(false);
          sessionStartedRef.current = false;
          setStatus('Private Athena TTS was turned OFF from Discord.');
          audioQueueRef.current = [];
          audioRef.current?.pause();
          return;
        }
        setBotName(String(data.botName || botName));
        setMediaUrl(String(data.mediaUrl || mediaUrl));
        const items = Array.isArray(data.items) ? data.items as PrivateTtsItem[] : [];
        if (items.length) {
          cursorRef.current = Math.max(cursorRef.current, Number(data.cursor || items.at(-1)?.cursor || 0));
          for (const item of items) {
            setPreview(buildSyntheticPreview({
              botName: String(data.botName || botName || 'Athena'),
              text: String(item.text || ''),
              question: String(item.question || ''),
              mediaUrl: String(data.mediaUrl || mediaUrl || ''),
            }));
            enqueueAudio(item.audioDataUris);
          }
        }
      } catch (error) {
        if (!cancelled) setStatus(`Connection interrupted. Retrying live Athena TTS… ${error instanceof Error ? error.message : ''}`.trim());
      } finally {
        pollingRef.current = false;
        if (!cancelled) timer = setTimeout(poll, 650);
      }
    };

    timer = setTimeout(poll, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, voice]);

  useEffect(() => {
    const shutDown = () => {
      if (!sessionStartedRef.current || !tokenRef.current) return;
      sessionStartedRef.current = false;
      void fetch('/api/private-chat/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ token: tokenRef.current, action: 'tts', mode: 'off' }),
      }).catch(() => {});
    };
    window.addEventListener('pagehide', shutDown);
    return () => window.removeEventListener('pagehide', shutDown);
  }, []);

  async function stop() {
    try {
      await postControl({ mode: 'off' });
    } catch {}
    sessionStartedRef.current = false;
    setEnabled(false);
    audioQueueRef.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setStatus('Private Athena TTS is OFF.');
  }

  function playResume() {
    const audio = audioRef.current;
    if (audio?.paused) {
      audio.play().then(() => setStatus('Athena is speaking…')).catch(() => {});
      return;
    }
    void playNext();
  }

  function toggleMic() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('Push-to-talk speech recognition is not supported in this browser.');
      return;
    }
    if (micActive) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = async (event: any) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
      setMicActive(false);
      if (!transcript) return;
      setMicTranscript(transcript);
      try {
        await navigator.clipboard.writeText(transcript);
        setStatus('Push-to-talk transcript copied. Paste it into your Discord DM to Athena.');
      } catch {
        setStatus('Push-to-talk captured your words. Copy the transcript below into Discord.');
      }
    };
    recognition.onerror = () => {
      setMicActive(false);
      setStatus('Push-to-talk mic error. Try again.');
    };
    recognition.onend = () => setMicActive(false);
    recognition.start();
    setMicActive(true);
    setStatus('Push-to-talk is listening…');
  }

  const fields = Array.isArray(preview?.fields)
    ? preview!.fields!.filter((field) => field?.name && field?.value && !String(field.value).includes('/private-chat/control'))
    : [];

  return (
    <main style={{ minHeight: '100vh', background: '#090b12', color: '#f4f6ff', fontFamily: 'system-ui, sans-serif', padding: '20px' }}>
      <div style={{ width: 'min(900px, 100%)', margin: '0 auto', display: 'grid', gap: 18 }}>
        <section style={{ border: '1px solid #292f43', borderRadius: 16, background: '#111522', padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>🔊 {botName} Private TTS</h1>
              <p style={{ margin: '6px 0 0', color: '#b7bdd1' }}>Athena-only private DM listener. Closing this page turns it off.</p>
            </div>
            <div style={{ fontWeight: 800, color: enabled ? '#8ef0b1' : '#ff9f9f' }}>{enabled ? '● LIVE' : '○ OFF'}</div>
          </div>
          <p style={{ minHeight: 24, color: '#c8cee0' }}>{status}</p>

          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <strong style={{ width: 70 }}>Volume</strong>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(volume * 100)}
                onChange={(event) => updateVolume(Number(event.target.value) / 100)}
                style={{ flex: '1 1 260px' }}
              />
              <span>{Math.round(volume * 100)}%</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <strong style={{ width: 70 }}>Voice</strong>
              <select
                value={voice}
                onChange={(event) => updateVoice(event.target.value)}
                style={{ flex: '1 1 320px', background: '#0b0e17', color: '#f4f6ff', border: '1px solid #3a4259', borderRadius: 8, padding: '9px 10px' }}
              >
                {VOICE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={playResume} style={{ border: '1px solid #4f6aa3', background: '#18213a', color: '#fff', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' }}>▶ Play / Resume</button>
              <button type="button" onClick={toggleMic} style={{ border: '1px solid #3c8d63', background: micActive ? '#4a1717' : '#153424', color: '#fff', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' }}>{micActive ? '🔴 Listening…' : '🎤 Push to talk'}</button>
              <button type="button" onClick={stop} style={{ border: '1px solid #a84f5c', background: '#40161d', color: '#fff', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' }}>■ Stop private TTS</button>
            </div>
            <p style={{ margin: 0, color: '#8f98ae', fontSize: 13 }}>Push-to-talk does not impersonate you through the Discord bot. It copies your speech transcript so you can paste it into the private DM.</p>
            {micTranscript && <div style={{ background: '#0b0e17', border: '1px solid #292f43', borderRadius: 9, padding: 10 }}><strong>Last mic transcript:</strong> {micTranscript}</div>}
          </div>
        </section>

        <section style={{ border: '1px solid #292f43', borderRadius: 16, background: '#111522', padding: 18 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 17 }}>Current Discord-style embed</h2>
          {preview ? (
            <article style={{ borderLeft: '4px solid #5865f2', borderRadius: 8, background: '#1b1d22', padding: 16, color: '#dbdee1' }}>
              {preview.author?.name && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 700 }}>
                  {preview.author.icon_url && <img src={preview.author.icon_url} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />}
                  <span>{preview.author.name}</span>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: preview.thumbnail?.url ? '1fr 80px' : '1fr', gap: 14 }}>
                <div>
                  {preview.title && <div style={{ fontWeight: 800, marginBottom: 8 }}>{preview.title}</div>}
                  {preview.description && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.48 }}>{preview.description}</div>}
                  {fields.map((field, index) => (
                    <div key={`${field.name}-${index}`} style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{field.name}</div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{field.value}</div>
                    </div>
                  ))}
                </div>
                {preview.thumbnail?.url && <img src={preview.thumbnail.url} alt="" style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover' }} />}
              </div>
              {(preview.image?.url || mediaUrl) && <img src={preview.image?.url || mediaUrl} alt="" style={{ display: 'block', width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 8, marginTop: 14, background: '#0b0d11' }} />}
              {preview.footer?.text && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, color: '#949ba4', fontSize: 12 }}>{preview.footer.icon_url && <img src={preview.footer.icon_url} alt="" style={{ width: 18, height: 18, borderRadius: '50%' }} />}{preview.footer.text}</div>}
            </article>
          ) : (
            <p style={{ color: '#8f98ae' }}>The Discord embed preview will appear when the signed reply loads.</p>
          )}
        </section>
      </div>
    </main>
  );
}
