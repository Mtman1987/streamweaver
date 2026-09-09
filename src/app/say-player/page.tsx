'use client';

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TTS_VOICE, TTS_VOICE_OPTIONS } from '@/lib/tts-voices';

const VOICE_OPTIONS = [
  { id: '', label: 'Default voice (Nova)' },
  ...TTS_VOICE_OPTIONS.map((voice) => ({
    id: voice.id,
    label: `${voice.label} — ${voice.providerLabel}`,
  })),
];

type VoiceIdentity = {
  discordUserId: string;
  discordUsername: string;
};

export default function SayPlayer() {
  const recognitionRef = useRef<any>(null);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const fallbackQueueRef = useRef<string[]>([]);
  const controlStartedRef = useRef(false);

  const [tenantId, setTenantId] = useState('');
  const [status, setStatus] = useState('Opening shared room TTS controls…');
  const [voice, setVoice] = useState('');
  const [identity, setIdentity] = useState<VoiceIdentity | null>(null);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [preferenceReady, setPreferenceReady] = useState(false);
  const [sharedRoom, setSharedRoom] = useState('discord-activity');
  const [fallbackVolume, setFallbackVolume] = useState(0.6);
  const [fallbackReady, setFallbackReady] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [micTranscript, setMicTranscript] = useState('');
  const [postingAs, setPostingAs] = useState('');
  const [publicReplyControl, setPublicReplyControl] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const streamKey = params.get('tenantId') || '';
    const controlToken = params.get('controlToken') || '';
    setTenantId(streamKey);
    setPublicReplyControl(Boolean(controlToken));

    try {
      const savedVolume = Number(localStorage.getItem('streamweaver-public-tts-fallback-volume') || '');
      if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) setFallbackVolume(savedVolume);
    } catch {}

    fetch('/api/say/preferences', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        const payload = result?.data || result || {};
        if (!response.ok || result?.ok === false) {
          setPreferenceReady(true);
          setStatus('Shared room TTS is ready. Sign in with your linked SPMT/Discord account to choose your own voice.');
          return;
        }
        setIdentity(payload.identity || null);
        setPostingAs(String(payload.identity?.discordUsername || ''));
        setVoice(String(payload.voice || ''));
        setPreferenceReady(true);
        setStatus(payload.voice
          ? `Your public TTS voice is ${voiceLabel(String(payload.voice))}. New Discord messages will use it.`
          : 'Shared room TTS is ready. Your messages use the default voice until you choose one.');
      })
      .catch(() => {
        setPreferenceReady(true);
        setStatus('Shared room TTS is ready. Voice preferences could not be loaded right now.');
      });

    if (controlToken && !controlStartedRef.current) {
      controlStartedRef.current = true;
      setStatus('Sending this bot reply to the shared HearMeOut room TTS…');
      fetch('/api/discord/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ token: controlToken, action: 'tts' }),
      }).then(async (response) => {
        const result = await response.json().catch(() => null);
        const payload = result?.data || result || {};
        if (!response.ok || result?.ok === false) throw new Error(result?.error || payload?.error || 'Public TTS failed');
        if (payload.delivered === 'hearmeout-room') {
          setSharedRoom(String(payload.roomId || 'discord-activity'));
          setStatus('Bot reply sent to the shared HearMeOut room TTS. Everyone in the room hears the same playback.');
          return;
        }
        const localFallback = Array.isArray(payload.audioDataUris)
          ? payload.audioDataUris.filter((item: unknown) => typeof item === 'string' && item.startsWith('data:audio'))
          : [];
        fallbackQueueRef.current = localFallback;
        setFallbackReady(localFallback.length > 0);
        setStatus(payload.message || 'Shared room TTS is unavailable. Local fallback is ready.');
      }).catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      });
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

  function voiceLabel(id: string) {
    return TTS_VOICE_OPTIONS.find((option) => option.id === id)?.label || id || 'Default voice';
  }

  async function updateVoice(nextVoice: string) {
    setVoice(nextVoice);
    if (!identity) {
      setStatus('Sign in with your linked SPMT/Discord account before saving a personal TTS voice.');
      return;
    }
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
      setStatus(payload.voice
        ? `Saved. Your public Discord TTS now uses ${voiceLabel(String(payload.voice))}, and everyone hears that voice in the room.`
        : 'Saved. Your public Discord TTS now uses the channel default voice.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setVoiceSaving(false);
    }
  }

  function updateFallbackVolume(nextVolume: number) {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    setFallbackVolume(clamped);
    if (fallbackAudioRef.current) fallbackAudioRef.current.volume = clamped;
    try { localStorage.setItem('streamweaver-public-tts-fallback-volume', String(clamped)); } catch {}
  }

  function playFallbackNext() {
    if (fallbackAudioRef.current && !fallbackAudioRef.current.ended && !fallbackAudioRef.current.paused) {
      void fallbackAudioRef.current.play();
      return;
    }
    const audioUrl = fallbackQueueRef.current.shift();
    if (!audioUrl) {
      setFallbackReady(false);
      setStatus('Local fallback finished. Shared HearMeOut room TTS remains the normal public path.');
      return;
    }
    const audio = new Audio(audioUrl);
    fallbackAudioRef.current = audio;
    audio.volume = fallbackVolume;
    audio.onended = () => {
      fallbackAudioRef.current = null;
      playFallbackNext();
    };
    audio.onerror = () => {
      fallbackAudioRef.current = null;
      playFallbackNext();
    };
    void audio.play().catch((error) => {
      fallbackQueueRef.current.unshift(audioUrl);
      fallbackAudioRef.current = null;
      setStatus(`Browser blocked local fallback playback: ${error?.message || 'tap Play local fallback again'}`);
    });
  }

  function toggleMic() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('Push-to-talk speech recognition is not supported in this browser.');
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
      const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
      setMicActive(false);
      if (!transcript) return;
      setMicTranscript(transcript);
      setStatus(`Posting “${transcript}” to chat and sending the same speech through room TTS…`);
      try {
        const response = await fetch('/api/say/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: transcript,
            streamKey: tenantId || undefined,
            voice: voice || undefined,
          }),
        });
        const result = await response.json().catch(() => null);
        const payload = result?.data || result || {};
        const verifiedName = payload?.identity?.username || payload?.details?.identity?.username;
        if (verifiedName) setPostingAs(verifiedName);
        if (!response.ok || result?.ok === false) {
          if (payload?.details?.posted || payload?.posted) {
            throw new Error(result?.error || 'Message posted, but TTS could not read it');
          }
          throw new Error(result?.error || payload?.error || 'Chat post failed');
        }
        setStatus(`Posted as ${verifiedName || postingAs || 'your signed-in profile'}. Shared room TTS is handling the audio.`);
      } catch (error) {
        setStatus(`Could not finish speech-to-chat: ${error instanceof Error ? error.message : String(error)}`);
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

  const roomLabel = sharedRoom === 'discord-activity' ? 'Discord Activities' : sharedRoom;
  const publicChannel = tenantId.startsWith('discord:') ? tenantId.slice('discord:'.length) : tenantId;

  return (
    <main style={{ minHeight: '100vh', background: '#090b12', color: '#f4f6ff', fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <div style={{ width: 'min(900px, 100%)', margin: '0 auto', display: 'grid', gap: 18 }}>
        <section style={{ border: '1px solid #292f43', borderRadius: 16, background: '#111522', padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>🔊 Public Room TTS</h1>
              <p style={{ margin: '6px 0 0', color: '#b7bdd1' }}>
                One shared voice lane for Discord chat and public bot-reply playback. Private bot TTS stays separate.
              </p>
            </div>
            <div style={{ fontWeight: 800, color: '#8ef0b1' }}>● ROOM LIVE</div>
          </div>

          <p style={{ minHeight: 24, color: '#c8cee0' }}>{status}</p>

          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 }}>
              <div style={{ background: '#0b0e17', border: '1px solid #292f43', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: '#8f98ae', textTransform: 'uppercase', letterSpacing: '.08em' }}>HearMeOut output</div>
                <strong>{roomLabel}</strong>
              </div>
              <div style={{ background: '#0b0e17', border: '1px solid #292f43', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: '#8f98ae', textTransform: 'uppercase', letterSpacing: '.08em' }}>Discord stream</div>
                <strong>{publicChannel || 'Open from a !say / !listen link'}</strong>
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <strong style={{ width: 90 }}>My voice</strong>
              <select
                value={voice}
                disabled={!identity || voiceSaving || !preferenceReady}
                onChange={(event) => void updateVoice(event.target.value)}
                style={{ flex: '1 1 360px', background: '#0b0e17', color: '#f4f6ff', border: '1px solid #3a4259', borderRadius: 8, padding: '9px 10px', opacity: !identity ? 0.65 : 1 }}
              >
                {VOICE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <p style={{ margin: '-6px 0 0 102px', color: '#8f98ae', fontSize: 13 }}>
              {identity
                ? `Linked Discord user: ${identity.discordUsername || identity.discordUserId}. This choice follows your public !say messages.`
                : `Sign in with your linked SPMT/Discord account to choose a voice. Until then the default is ${voiceLabel(DEFAULT_TTS_VOICE)}.`}
            </p>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={toggleMic}
                style={{ border: '1px solid #3c8d63', background: micActive ? '#4a1717' : '#153424', color: '#fff', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' }}
              >
                {micActive ? '🔴 Listening…' : '🎤 Speak to Chat'}
              </button>
              {fallbackReady ? (
                <button
                  type="button"
                  onClick={playFallbackNext}
                  style={{ border: '1px solid #a77945', background: '#3c2814', color: '#fff', borderRadius: 9, padding: '10px 14px', cursor: 'pointer' }}
                >
                  ▶ Play local fallback
                </button>
              ) : null}
            </div>

            {fallbackReady ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <strong style={{ width: 90 }}>Fallback</strong>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(fallbackVolume * 100)}
                  onChange={(event) => updateFallbackVolume(Number(event.target.value) / 100)}
                  style={{ flex: '1 1 260px' }}
                />
                <span>{Math.round(fallbackVolume * 100)}%</span>
              </label>
            ) : null}

            <p style={{ margin: 0, color: '#8f98ae', fontSize: 13 }}>
              Bot replies are not auto-read. Clicking 🔊 on a public bot embed sends that reply into this same shared room lane. The bot keeps its configured voice; your selected voice applies to your own chat TTS.
            </p>
            {publicReplyControl ? (
              <p style={{ margin: 0, color: '#aeb9db', fontSize: 13 }}>
                This panel was opened from a public bot reply. It has already attempted to send that reply to the room.
              </p>
            ) : null}
            {postingAs ? <p style={{ margin: 0, color: '#8ef0b1', fontSize: 13 }}>Posting as verified user: {postingAs}</p> : null}
            {micTranscript ? (
              <div style={{ background: '#0b0e17', border: '1px solid #292f43', borderRadius: 9, padding: 10 }}>
                <strong>Last mic transcript:</strong> {micTranscript}
              </div>
            ) : null}
          </div>
        </section>

        <section style={{ border: '1px solid #292f43', borderRadius: 16, background: '#111522', padding: 18 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>How public TTS behaves</h2>
          <p style={{ margin: 0, color: '#b7bdd1', lineHeight: 1.55 }}>
            Your Discord <strong>!say</strong> setting decides whether your human messages are spoken. Talking directly to a bot no longer bypasses that setting just because the original Discord message is folded into the bot embed. Playback is shared through HearMeOut, so people in the room hear the same voice instead of each opening an independent player.
          </p>
        </section>
      </div>
    </main>
  );
}
