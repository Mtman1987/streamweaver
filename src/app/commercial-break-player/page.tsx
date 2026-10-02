'use client';

import { useEffect, useRef, useState } from 'react';
import { useLoungeBroadcastVolume } from '@/lib/lounge-broadcast-volume';

const GIF_COUNT = 15;
const GIF_DURATION_MS = 12_000;
const DSH_GIFS = 'https://discord-stream-hub-new.fly.dev/api/lounge/brb-gifs';
const THEME_TRACKS = [
  'https://hearmeout-main.fly.dev/api/lounge/theme-music?track=spmt',
  'https://hearmeout-main.fly.dev/api/lounge/theme-music?track=spmt2',
  'https://hearmeout-main.fly.dev/api/lounge/theme-music?track=spmt3',
  'https://hearmeout-main.fly.dev/api/lounge/theme-music?track=spmt4',
];

type Gif = { url: string; user: string; bytes?: number };
type State = {
  phase: 'IDLE' | 'ACTIVE' | 'COOLDOWN';
  breakStartedAt: number;
  activeUntil: number;
  cooldownUntil: number;
  mediaActive: boolean;
};

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function CommercialBreakPlayer() {
  const level = useLoungeBroadcastVolume('media');
  const audioRef = useRef<HTMLAudioElement>(null);
  const breakRef = useRef(0);
  const themeRef = useRef(0);
  const mediaActiveRef = useRef(true);
  const activeRef = useRef(false);
  const gifReadyRef = useRef(false);
  const [state, setState] = useState<State>({ phase: 'IDLE', breakStartedAt: 0, activeUntil: 0, cooldownUntil: 0, mediaActive: true });
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [gifIndex, setGifIndex] = useState(0);
  const [visibleGifUrl, setVisibleGifUrl] = useState('');
  const displayedGif = gifs.length ? gifs[gifIndex % gifs.length] : null;
  const gifReady = Boolean(displayedGif && visibleGifUrl === displayedGif.url);
  gifReadyRef.current = gifReady;

  useEffect(() => {
    if (audioRef.current && level !== null) {
      audioRef.current.volume = Math.min(0.15, level * 0.2);
      audioRef.current.muted = level <= 0;
    }
  }, [level]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch('/api/lounge/commercial-break', { cache: 'no-store' });
        if (response.ok) {
          const next = await response.json() as State;
          if (!stopped) {
            mediaActiveRef.current = next.mediaActive === true;
            activeRef.current = next.phase === 'ACTIVE' && Date.now() < Number(next.activeUntil || 0);
            setState(next);
          }
        }
      } catch {}
      if (!stopped) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const active = state.phase === 'ACTIVE' && Date.now() < state.activeUntil;
    activeRef.current = active;
    mediaActiveRef.current = state.mediaActive === true;
    const audio = audioRef.current;
    if (!audio) return;

    if (!active || state.mediaActive || !gifReady || level === null) {
      audio.pause();
      return;
    }

    if (breakRef.current !== state.breakStartedAt) {
      breakRef.current = state.breakStartedAt;
      themeRef.current = Math.abs(Math.floor(state.breakStartedAt / 1000)) % THEME_TRACKS.length;
      audio.src = THEME_TRACKS[themeRef.current];
      audio.currentTime = 0;
      audio.load();
    }
    audio.volume = Math.min(0.15, level * 0.2);
    audio.muted = level <= 0;
    audio.play().catch(() => {});
  }, [state.phase, state.breakStartedAt, state.activeUntil, state.mediaActive, gifReady, level]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTheme = () => {
      if (!activeRef.current || mediaActiveRef.current || !gifReadyRef.current || audio.volume <= 0) return;
      themeRef.current = (themeRef.current + 1) % THEME_TRACKS.length;
      audio.src = THEME_TRACKS[themeRef.current];
      audio.currentTime = 0;
      audio.load();
      audio.play().catch(() => {});
    };
    audio.addEventListener('ended', nextTheme);
    audio.addEventListener('error', nextTheme);
    return () => {
      audio.removeEventListener('ended', nextTheme);
      audio.removeEventListener('error', nextTheme);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch(DSH_GIFS, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error('GIF list unavailable');
        const payload = await response.json();
        const candidates: Gif[] = (Array.isArray(payload?.gifs) ? payload.gifs : [])
          .filter((gif: any) => typeof gif?.url === 'string' && gif.url.startsWith('https://discord-stream-hub-new.fly.dev/api/media/'))
          .map((gif: any) => ({ url: gif.url, user: String(gif.user || ''), bytes: Number(gif.bytes) || undefined }));
        // Legacy recordings can exceed 30 MB. Prefer bounded GIFs and let the
        // visible image load first instead of waiting for every download.
        const smaller = candidates.filter((gif) => !gif.bytes || gif.bytes <= 8 * 1024 * 1024);
        const selected = shuffle(smaller.length ? smaller : candidates).slice(0, GIF_COUNT);
        if (!selected.length) throw new Error('No GIFs available');
        if (!cancelled) {
          setGifs(selected);
          setGifIndex(0);
          // Warm the first visible image before a commercial starts.
          for (const gif of selected.slice(0, 2)) {
            const image = new Image();
            image.src = gif.url;
          }
        }
      } catch { if (!cancelled) retry = setTimeout(load, 3000); }
    };
    void load();
    return () => { cancelled = true; clearTimeout(retry); };
  }, []);

  useEffect(() => {
    if (state.phase !== 'ACTIVE') setVisibleGifUrl('');
    setGifIndex(0);
  }, [state.breakStartedAt, state.phase]);

  useEffect(() => {
    if (state.phase !== 'ACTIVE' || gifs.length < 2 || !gifReady) return;
    const timer = setTimeout(() => setGifIndex((index) => (index + 1) % gifs.length), GIF_DURATION_MS);
    return () => clearTimeout(timer);
  }, [state.phase, gifs, gifReady, gifIndex]);

  const active = state.phase === 'ACTIVE' && Date.now() < state.activeUntil;
  const gif = active && gifs.length ? gifs[gifIndex % gifs.length] : null;

  return (
    <main style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: active && gifReady ? '#071127' : 'transparent',
      opacity: active && gifReady ? 1 : 0, pointerEvents: 'none',
    }}>
      <audio ref={audioRef} preload="auto" />
      {active && gif && <img key={gif.url} src={gif.url} onLoad={() => setVisibleGifUrl(gif.url)} onError={() => { setVisibleGifUrl(''); setGifs((current) => current.filter((entry) => entry.url !== gif.url)); }} alt={gif.user ? `${gif.user}'s community GIF` : 'Community GIF'} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      {active && <div style={{
        position: 'absolute', left: '50%', top: 12, transform: 'translateX(-50%)',
        padding: '7px 20px', borderRadius: 999, background: '#071127',
        border: '1px solid #54dffa', boxShadow: '0 0 15px rgba(58,197,248,.45)',
        color: '#eefaff', font: '800 clamp(14px,2.6vw,24px) system-ui,sans-serif',
        letterSpacing: '.15em', whiteSpace: 'nowrap',
      }}>AND NOW A WORD FROM OUR SPONSORS</div>}
      {active && gif?.user && <div style={{
        position: 'absolute', right: 20, bottom: 20, padding: '8px 14px',
        borderRadius: 9, background: 'rgba(5,12,30,.83)',
        border: '1px solid rgba(103,232,249,.65)', color: '#e8fbff',
        font: '700 16px system-ui,sans-serif',
      }}>📹 {gif.user}</div>}
    </main>
  );
}
