'use client';

import { useEffect, useRef, useState } from 'react';
import { applySavedSink } from '@/services/audio-sink';

export default function TTSPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastUrlRef = useRef<string>('');
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Click to enable TTS playback');

  useEffect(() => {
    if (!enabled) return;

    const checkForUpdate = async () => {
      try {
        // Lightweight poll — only fetches the timestamp
        const pollRes = await fetch('/api/tts/current?poll=1');
        if (!pollRes.ok) return;
        const pollData = await pollRes.json();

        if (!pollData.updatedAt || pollData.updatedAt === lastUrlRef.current) return;

        // New audio available — fetch the full payload
        const fullRes = await fetch('/api/tts/current');
        if (!fullRes.ok) return;
        const data = await fullRes.json();

        if (data.audioUrl && data.updatedAt) {
          lastUrlRef.current = data.updatedAt;
          console.log('[TTS Player] New audio detected, updatedAt:', data.updatedAt);
          if (audioRef.current) {
            audioRef.current.src = data.audioUrl;
            audioRef.current.volume = 1.0;
            try {
              await applySavedSink(audioRef.current);
            } catch {}
            audioRef.current.play()
              .then(() => setStatus('Playing...'))
              .catch(err => setStatus(`Play failed: ${err.message}`));
          }
        }
      } catch (err) {
        console.error('[TTS Player] Check failed:', err);
      }
    };

    const interval = setInterval(checkForUpdate, 500);
    return () => clearInterval(interval);
  }, [enabled]);

  const handleEnable = () => {
    // Play a silent audio to unlock autoplay
    if (audioRef.current) {
      audioRef.current.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
      audioRef.current.play().then(() => {
        setEnabled(true);
        setStatus('Listening for TTS...');
      }).catch(() => {
        setEnabled(true);
        setStatus('Listening for TTS (autoplay may be blocked)');
      });
    }
  };

  if (!enabled) {
    return (
      <div
        onClick={handleEnable}
        style={{
          width: '100%', height: '100vh', background: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontFamily: 'sans-serif', color: '#888',
        }}
      >
        <audio ref={audioRef} />
        <span>🔊 Click anywhere to enable TTS</span>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100vh', background: 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'sans-serif', color: '#666', fontSize: '12px',
    }}>
      <audio
        ref={audioRef}
        onPlaying={() => setStatus('Playing...')}
        onEnded={() => setStatus('Listening for TTS...')}
      />
      <span>{status}</span>
    </div>
  );
}
