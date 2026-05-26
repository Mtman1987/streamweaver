'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export default function TtsPlayerPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isTalking, setIsTalking] = useState(false);
  const [status, setStatus] = useState('Preparing playback...');

  const { tenantId, text } = useMemo(() => {
    if (typeof window === 'undefined') return { tenantId: '', text: '' };
    const url = new URL(window.location.href);
    return {
      tenantId: (url.searchParams.get('tenantId') || '').trim(),
      text: (url.searchParams.get('text') || '').trim(),
    };
  }, []);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const avatarTenantParam = tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : '';
  const idleAvatar = `${baseUrl}/api/avatars?type=idle&format=gif${avatarTenantParam}`;
  const talkingAvatar = `${baseUrl}/api/avatars?type=talking&format=gif${avatarTenantParam}`;
  const audioUrl = `${baseUrl}/api/tts/play?tenantId=${encodeURIComponent(tenantId)}&text=${encodeURIComponent(text.slice(0, 500))}`;

  useEffect(() => {
    if (!text) {
      setStatus('Missing text query parameter.');
      return;
    }

    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.onplay = () => {
      setIsTalking(true);
      setStatus('Playing TTS...');
    };
    audio.onended = () => {
      setIsTalking(false);
      setStatus('Playback complete.');
    };
    audio.onerror = () => {
      setIsTalking(false);
      setStatus('Failed to play audio.');
    };

    audio.play().catch(() => {
      setStatus('Autoplay blocked. Press Play to continue.');
    });

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [audioUrl, text]);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-950 p-6 space-y-4">
        <h1 className="text-xl font-semibold">Athena TTS Player</h1>
        <p className="text-sm text-zinc-400">{status}</p>
        <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 p-4 flex items-center gap-4">
          <img src={isTalking ? talkingAvatar : idleAvatar} alt="Athena avatar" className="w-28 h-28 rounded-lg object-cover"
            onError={(e) => { const el = e.currentTarget; if (isTalking && !el.dataset.fallbackTried) { el.dataset.fallbackTried = '1'; (el as HTMLImageElement).src = idleAvatar; } }} />
          <div className="flex-1">
            <div className="text-sm text-zinc-400 mb-1">Message</div>
            <div className="text-sm leading-relaxed whitespace-pre-wrap">{text || '(empty)'}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500"
            onClick={() => audioRef.current?.play().catch(() => {})}
          >
            Play
          </button>
          <button
            className="px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600"
            onClick={() => {
              audioRef.current?.pause();
              setIsTalking(false);
              setStatus('Paused.');
            }}
          >
            Pause
          </button>
        </div>
      </div>
    </div>
  );
}
