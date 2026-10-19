'use client';

import { getSpeechRecognitionConstructor } from '@/services/microphone-recognition';

import { useEffect, useRef, useState } from 'react';
import { TTS_VOICE_OPTIONS, normalizeTtsVoice } from '@/lib/tts-voices';

const VOICE_OPTIONS = [
  { id: '', label: 'Tenant default' },
  ...TTS_VOICE_OPTIONS.filter((voice) => voice.provider === 'kokoro').map((voice) => ({
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
  mediaUrl?: string;
}): PreviewEmbed {
  return {
    author: { name: input.botName || 'Athena' },
    description: input.text,
    ...(input.mediaUrl ? { image: { url: input.mediaUrl } } : {}),
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
  const [voiceOptions, setVoiceOptions] = useState(VOICE_OPTIONS);
  const [preview, setPreview] = useState<PreviewEmbed | null>(null);
  const [botName, setBotName] = useState('Athena');
  const [mediaUrl, setMediaUrl] = useState('');
  const [micActive, setMicActive] = useState(false);
  const [micTranscript, setMicTranscript] = useState('');
  const [sendingTranscript, setSendingTranscript] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<PrivateTtsItem[]>([]);

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
        const data = await postControl({ mode: 'on' });
        if (cancelled) return;
        const isEnabled = data.ttsEnabled === true;
        setEnabled(isEnabled);
        sessionStartedRef.current = isEnabled;
        setBotName(String(data.botName || 'Athena'));
        setMediaUrl(String(data.mediaUrl || ''));
        if (Array.isArray(data.voices)) {
          const availableVoices = [
            { id: '', label: 'Tenant default' },
            ...data.voices.map((option: any) => ({ id: String(option.id), label: `${String(option.label)} — ${String(option.providerLabel || 'TTS')}` })),
          ];
          setVoiceOptions(availableVoices);
          const supported = new Set(availableVoices.map((option) => option.id));
          setVoice((current) => supported.has(current) ? current : '');
        }
        cursorRef.current = Math.max(0, Number(data.cursor || 0));
        setHistoryEntries(data.currentText ? [{
          cursor: cursorRef.current,
          text: String(data.currentText),
          timestamp: new Date().toISOString(),
          audioDataUris: Array.isArray(data.audioDataUris) ? data.audioDataUris : [],
        }] : []);
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
          setStatus('Private TTS is currently off. Use the 🔊 control in the DM to start it.');
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
          setHistoryEntries((current) => [...current, ...items].slice(-50));
          for (const item of items) {
            setPreview(buildSyntheticPreview({
              botName: String(data.botName || botName || 'Athena'),
              text: String(item.text || ''),
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

  const microphoneRef = useRef<any>(null);
  useEffect(() => () => microphoneRef.current?.abort(), []);

  function toggleMic() {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setStatus('Push-to-talk speech recognition is not supported in this browser.');
      return;
    }
    if (microphoneRef.current) { microphoneRef.current.stop(); return; }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
      setMicActive(false);
      if (!transcript) {
        setStatus('No speech was recognized. Try again or type your message below.');
        return;
      }
      setMicTranscript(transcript);
      setStatus('Transcript ready. Correct any mistakes, then send it privately to Athena.');
    };
    recognition.onerror = (event: any) => {
      setMicActive(false);
      setStatus(event?.message || 'Microphone permission or recognition failed. Try again.');
    };
    recognition.onend = () => { microphoneRef.current = null; setMicActive(false); };
    recognition.onstart = () => { setMicActive(true); setStatus("Microphone ready. Speak, then tap Finish."); };
    recognition.onprocessing = () => setStatus("Transcribing microphone clip…");
    microphoneRef.current = recognition;
    recognition.start();
    setStatus('Starting microphone… speak when it is ready.');
  }

  async function sendTranscript() {
    const transcript = micTranscript.trim();
    if (!transcript) {
      setStatus('Speak first or type a message in the transcript box.');
      return;
    }
    if (sendingTranscript) return;
    setSendingTranscript(true);
    try {
      const data = await postControl({ mode: 'send', message: transcript });
      if (data.submitted !== true) throw new Error(data.message || 'The private message was not sent.');
      const reply = String(data.reply || '').trim();
      const cursor = Math.max(0, Number(data.cursor || 0));
      if (cursor) cursorRef.current = Math.max(cursorRef.current, cursor);
      setBotName(String(data.botName || botName));
      setMediaUrl(String(data.mediaUrl || mediaUrl));
      if (data.currentEmbed && typeof data.currentEmbed === 'object') {
        setPreview(data.currentEmbed as PreviewEmbed);
      } else if (reply) {
        setPreview(buildSyntheticPreview({ botName: String(data.botName || botName), text: reply, mediaUrl: String(data.mediaUrl || mediaUrl) }));
      }
      if (reply) {
        const item: PrivateTtsItem = {
          cursor,
          question: transcript,
          text: reply,
          timestamp: new Date().toISOString(),
          audioDataUris: Array.isArray(data.audioDataUris) ? data.audioDataUris : [],
        };
        setHistoryEntries((current) => [...current, item].slice(-50));
      }
      enqueueAudio(data.audioDataUris);
      setMicTranscript('');
      setStatus(String(data.message || 'Athena replied privately. Your transcript was not sent as a separate Discord message.'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSendingTranscript(false);
    }
  }

  async function testVoice() {
    try {
      setStatus('Generating a short test with the selected voice…');
      const data = await postControl({ mode: 'test' });
      enqueueAudio(data.audioDataUris);
      setStatus(String(data.message || 'Test voice generated. Tap Play / Resume if playback is blocked.'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
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
                {voiceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={playResume} style={{ border: '1px solid #4f6aa3', background: '#18213a', color: '#fff', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' }}>▶ Play / Resume</button>
              <button type="button" onClick={testVoice} style={{ border: '1px solid #7a68be', background: '#292044', color: '#fff', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' }}>🔈 Test voice</button>
              <button type="button" onClick={toggleMic} style={{ border: '1px solid #3c8d63', background: micActive ? '#4a1717' : '#153424', color: '#fff', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' }}>{micActive ? '🔴 Finish recording' : '🎤 Speak'}</button>
              <button type="button" onClick={stop} style={{ border: '1px solid #a84f5c', background: '#40161d', color: '#fff', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' }}>■ Stop private TTS</button>
            </div>
            <label style={{ display: 'grid', gap: 8 }}>
              <strong>Message to Athena (editable transcript)</strong>
              <textarea
                value={micTranscript}
                onChange={(event) => setMicTranscript(event.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="Tap Speak, then correct the transcript here—or type your message directly."
                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: '#0b0e17', color: '#f4f6ff', border: '1px solid #3a4259', borderRadius: 9, padding: 12, lineHeight: 1.45, font: 'inherit' }}
              />
            </label>
            <button type="button" onClick={sendTranscript} disabled={sendingTranscript || !micTranscript.trim()} style={{ border: '1px solid #4fa476', background: sendingTranscript ? '#293148' : '#153424', color: '#fff', borderRadius: 9, padding: '12px 16px', fontWeight: 800, cursor: sendingTranscript ? 'wait' : 'pointer', opacity: sendingTranscript || !micTranscript.trim() ? 0.65 : 1 }}>
              {sendingTranscript ? 'Sending privately…' : '➤ Send privately to Athena'}
            </button>
            <p style={{ margin: 0, color: '#8f98ae', fontSize: 13 }}>Your transcript goes to the private-chat pipeline only. Discord receives Athena’s reply embed; your words appear in its footer with your avatar, not as a separate copied DM.</p>
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

        <section style={{ border: '1px solid #292f43', borderRadius: 16, background: '#111522', padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>Private conversation history</h2>
            <span style={{ color: '#8f98ae', fontSize: 12 }}>Most recent 50 turns</span>
          </div>
          <div aria-live="polite" style={{ marginTop: 12, display: 'grid', gap: 10, maxHeight: 340, overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 4 }}>
            {historyEntries.length ? historyEntries.map((item, index) => (
              <article key={`${item.cursor}-${item.timestamp || index}-${index}`} style={{ border: '1px solid #292f43', borderRadius: 10, background: '#0b0e17', padding: 12 }}>
                {item.question ? <><strong style={{ color: '#a9bbff' }}>You</strong><p style={{ whiteSpace: 'pre-wrap', margin: '5px 0 10px', lineHeight: 1.45 }}>{item.question}</p></> : null}
                <strong style={{ color: '#8ef0b1' }}>{botName}</strong>
                <p style={{ whiteSpace: 'pre-wrap', margin: '5px 0 0', lineHeight: 1.48 }}>{item.text}</p>
                {item.timestamp ? <small style={{ display: 'block', marginTop: 8, color: '#7f899f' }}>{new Date(item.timestamp).toLocaleTimeString()}</small> : null}
              </article>
            )) : <p style={{ margin: 0, color: '#8f98ae' }}>Your recent private replies will appear here and remain scrollable.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
