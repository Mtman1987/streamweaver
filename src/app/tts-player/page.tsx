'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { applySavedSink } from '@/services/audio-sink';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';
import type { AvatarGestureName } from '@/lib/avatar-gestures';
import { LoungeAttributionMarquee } from '@/components/overlay/lounge-attribution-marquee';

type AvatarSettings = {
  animationType: 'mp4' | 'gif' | 'lottie';
  idleUrl: string;
  talkingUrl: string;
  displayMode: string;
};

type StellaPhase = 'idle' | 'talking' | 'gesture';
type StellaController = {
  startTalking: (gesture?: AvatarGestureName | null) => void;
  stopTalking: () => void;
};

const STELLA_IDLE_URL = 'https://gcdn.picsart.com/editing-temp/b55605a1-8387-461f-861e-a7abbc82e013.gif';
const STELLA_TALKING_URL = 'https://gcdn.picsart.com/editing-temp/09f4108b-b089-4e29-90c4-ef4afce292c0.gif';
const STELLA_LOOP_MS = 15_900;
const STELLA_RNG_SKIP_CHANCE = 0.48;
const STELLA_GESTURES: Record<AvatarGestureName, { url: string; weight: number }> = {
  blow_kiss_gesture: { url: 'https://gcdn.picsart.com/editing-temp/74ef952f-e76b-4641-9154-bf62f7e06e6f.mp4', weight: 0.55 },
  happy_gesture: { url: 'https://gcdn.picsart.com/editing-temp/912dd45e-a6fa-4fff-8cd7-73fe1f0b4eb8.mp4', weight: 1.2 },
  spin_gesture: { url: 'https://gcdn.picsart.com/editing-temp/bb1acf70-0ffd-4da8-8e73-d025533d3f1c.mp4', weight: 0.5 },
  wave_gesture: { url: 'https://gcdn.picsart.com/editing-temp/79b8a5fb-a2ba-472f-be22-87cda5637cc8.mp4', weight: 1.0 },
  playful_tilt_gesture: { url: 'https://gcdn.picsart.com/editing-temp/438968c2-f62a-439a-b830-f98b39868087.mp4', weight: 0.8 },
  laugh_gesture: { url: 'https://gcdn.picsart.com/editing-temp/0fb155ac-e8bd-4568-a98f-a36c9985235b.mp4', weight: 0.9 },
};

const ALL_GESTURES = Object.keys(STELLA_GESTURES) as AvatarGestureName[];

function weightedChoice(items: AvatarGestureName[]): AvatarGestureName {
  const total = items.reduce((sum, item) => sum + STELLA_GESTURES[item].weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= STELLA_GESTURES[item].weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function ChromaGestureVideo({ gesture, onEnded }: { gesture: AvatarGestureName; onEnded: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const paintedRef = useRef(false);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let stopped = false;
    const render = () => {
      if (stopped) return;
      if (video.readyState >= 2) {
        const width = 240;
        const height = Math.max(1, Math.round(width * (video.videoHeight || 1920) / (video.videoWidth || 1080)));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        try {
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(video, 0, 0, width, height);
          const frame = ctx.getImageData(0, 0, width, height);
          const data = frame.data;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const dominance = g - Math.max(r, b);
            if (g > 85 && dominance > 42) {
              data[i + 3] = 0;
            } else if (g > 75 && dominance > 22) {
              data[i + 3] = Math.max(0, Math.min(255, Math.round(255 * (42 - dominance) / 20)));
            }
          }
          ctx.putImageData(frame, 0, 0);
          if (!paintedRef.current) {
            paintedRef.current = true;
            setPainted(true);
          }
        } catch {
          // If a browser refuses pixel access, keep playback alive; the next
          // animation still returns to idle rather than wedging the controller.
        }
      }
      rafRef.current = requestAnimationFrame(render);
    };

    video.currentTime = 0;
    video.play().catch(() => {});
    render();
    return () => {
      stopped = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      video.pause();
    };
  }, [gesture]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <img
        src={STELLA_IDLE_URL}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          opacity: painted ? 0 : 1,
        }}
      />
      <video
        ref={videoRef}
        src={STELLA_GESTURES[gesture].url}
        crossOrigin="anonymous"
        muted
        playsInline
        preload="auto"
        onEnded={onEnded}
        style={{ display: 'none' }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          opacity: painted ? 1 : 0,
        }}
      />
    </div>
  );
}

function StellaAvatar({ controllerRef }: { controllerRef: React.MutableRefObject<StellaController | null> }) {
  const [phase, setPhase] = useState<StellaPhase>('idle');
  const [gesture, setGesture] = useState<AvatarGestureName | null>(null);
  const [loopKey, setLoopKey] = useState(0);
  const phaseRef = useRef<StellaPhase>('idle');
  const talkingRequestedRef = useRef(false);
  const aiGestureRef = useRef<AvatarGestureName | null>(null);
  const rngGestureRef = useRef<AvatarGestureName | null>(null);
  const bagRef = useRef<AvatarGestureName[]>([...ALL_GESTURES]);
  const boundaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rngTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const imageUrls = [STELLA_IDLE_URL, STELLA_TALKING_URL];
    const images = imageUrls.map((src) => {
      const image = new Image();
      image.src = src;
      image.decode?.().catch(() => {});
      return image;
    });
    const videos = ALL_GESTURES.map((name) => {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.src = STELLA_GESTURES[name].url;
      video.load();
      return video;
    });
    return () => {
      videos.forEach((video) => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
      images.forEach((image) => { image.src = ''; });
    };
  }, []);

  const clearBoundary = useCallback(() => {
    if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
    boundaryTimerRef.current = null;
  }, []);

  const clearRng = useCallback(() => {
    if (rngTimerRef.current) clearTimeout(rngTimerRef.current);
    rngTimerRef.current = null;
  }, []);

  const enterPhase = useCallback((next: StellaPhase, nextGesture?: AvatarGestureName | null) => {
    clearBoundary();
    phaseRef.current = next;
    setPhase(next);
    setGesture(next === 'gesture' ? (nextGesture || null) : null);
    setLoopKey(value => value + 1);
  }, [clearBoundary]);

  const playGesture = useCallback((name: AvatarGestureName) => {
    rngGestureRef.current = null;
    enterPhase('gesture', name);
  }, [enterPhase]);

  const boundary = useCallback(() => {
    const current = phaseRef.current;
    if (current === 'gesture') return;

    if (current === 'idle') {
      if (talkingRequestedRef.current) {
        enterPhase('talking');
        return;
      }
      if (aiGestureRef.current) {
        const next = aiGestureRef.current;
        aiGestureRef.current = null;
        playGesture(next);
        return;
      }
      if (rngGestureRef.current) {
        const next = rngGestureRef.current;
        rngGestureRef.current = null;
        playGesture(next);
        return;
      }
      setLoopKey(value => value + 1);
      boundaryTimerRef.current = setTimeout(boundary, STELLA_LOOP_MS);
      return;
    }

    if (talkingRequestedRef.current) {
      setLoopKey(value => value + 1);
      boundaryTimerRef.current = setTimeout(boundary, STELLA_LOOP_MS);
      return;
    }
    if (aiGestureRef.current) {
      const next = aiGestureRef.current;
      aiGestureRef.current = null;
      playGesture(next);
      return;
    }
    enterPhase('idle');
  }, [enterPhase, playGesture]);

  const scheduleBoundary = useCallback(() => {
    clearBoundary();
    boundaryTimerRef.current = setTimeout(boundary, STELLA_LOOP_MS);
  }, [boundary, clearBoundary]);

  const scheduleRng = useCallback(() => {
    clearRng();
    const delay = 10_000 + Math.floor(Math.random() * 20_001);
    rngTimerRef.current = setTimeout(() => {
      rngTimerRef.current = null;
      if (phaseRef.current !== 'idle' || talkingRequestedRef.current || aiGestureRef.current) {
        scheduleRng();
        return;
      }
      if (Math.random() < STELLA_RNG_SKIP_CHANCE) {
        scheduleRng();
        return;
      }
      if (bagRef.current.length === 0) bagRef.current = [...ALL_GESTURES];
      const selected = weightedChoice(bagRef.current);
      bagRef.current = bagRef.current.filter(item => item !== selected);
      rngGestureRef.current = selected;
    }, delay);
  }, [clearRng]);

  useEffect(() => {
    controllerRef.current = {
      startTalking: (requestedGesture) => {
        clearRng();
        rngGestureRef.current = null;
        if (requestedGesture) aiGestureRef.current = requestedGesture;
        talkingRequestedRef.current = true;

        // Speech owns the avatar immediately. Do not wait for the current
        // idle GIF loop boundary or short TTS can finish before Stella talks.
        if (phaseRef.current === 'idle') {
          enterPhase('talking');
        }
      },
      stopTalking: () => {
        talkingRequestedRef.current = false;
      },
    };
    return () => { controllerRef.current = null; };
  }, [clearRng, controllerRef, enterPhase]);

  useEffect(() => {
    if (phase === 'gesture') {
      clearBoundary();
      clearRng();
      return;
    }
    scheduleBoundary();
    if (phase === 'idle') scheduleRng();
    else clearRng();
    return () => {
      clearBoundary();
      clearRng();
    };
  }, [phase, loopKey, clearBoundary, clearRng, scheduleBoundary, scheduleRng]);

  const onGestureEnded = useCallback(() => {
    setGesture(null);
    if (talkingRequestedRef.current) {
      enterPhase('talking');
      return;
    }
    if (aiGestureRef.current) {
      const next = aiGestureRef.current;
      aiGestureRef.current = null;
      playGesture(next);
      return;
    }
    enterPhase('idle');
  }, [enterPhase, playGesture]);

  if (phase === 'gesture' && gesture) {
    return <ChromaGestureVideo key={gesture} gesture={gesture} onEnded={onGestureEnded} />;
  }

  const src = phase === 'talking' ? STELLA_TALKING_URL : STELLA_IDLE_URL;
  return <img key={`${phase}-${loopKey}`} src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
}

export default function TTSPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const stellaControllerRef = useRef<StellaController | null>(null);
  const [status, setStatus] = useState('Listening for TTS...');
  const [playing, setPlaying] = useState(false);
  const [avatar, setAvatar] = useState<AvatarSettings | null>(null);
  const [alwaysShow, setAlwaysShow] = useState(false);
  const hideTimer = useRef<NodeJS.Timeout | null>(null);
  const [visible, setVisible] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [captionText, setCaptionText] = useState('');
  const [captionVisible, setCaptionVisible] = useState(false);
  const captionTypeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const captionLingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayTenant = getOverlayTenantId();
  const tenantQuery = overlayTenant ? `tenant=${encodeURIComponent(overlayTenant)}` : '';
  const isStella = overlayTenant === 'spacemountainlive';
  const loungePlacement = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('placement') === 'lounge';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowControls(params.get('controls') === '1');
  }, []);

  useEffect(() => {
    if (!overlayTenant) return;
    const heartbeat = () => {
      fetch('/api/tts/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: overlayTenant, kind: 'overlay' }),
        keepalive: true,
      }).catch(() => {});
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 10_000);
    const refreshIfVisible = () => { if (document.visibilityState === 'visible') heartbeat(); };
    window.addEventListener('focus', heartbeat);
    window.addEventListener('online', heartbeat);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', heartbeat);
      window.removeEventListener('online', heartbeat);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [overlayTenant]);

  useEffect(() => {
    if (isStella) {
      setAlwaysShow(true);
      setVisible(true);
      return;
    }
    const suffix = overlayTenant ? `&tenant=${encodeURIComponent(overlayTenant)}` : '';
    const loadAvatar = () => {
      fetch(`/api/avatars?type=settings${suffix}`, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(payload => {
          const d = payload?.data;
          if (!d?.idleFile && !d?.idleUrl) {
            setAvatar(null);
            return;
          }
          const t = (d.animationType === 'json' ? 'lottie' : d.animationType) as AvatarSettings['animationType'];
          setAvatar({
            animationType: t,
            idleUrl: d.idleUrl || `/api/avatars?type=idle&format=${t}${suffix}`,
            talkingUrl: d.talkingUrl || (d.talkingFile ? `/api/avatars?type=talking&format=${t}${suffix}` : (d.idleUrl || `/api/avatars?type=idle&format=${t}${suffix}`)),
            displayMode: d.displayMode || 'auto',
          });
          const always = d.displayMode === 'always';
          setAlwaysShow(always);
          if (always) setVisible(true);
        })
        .catch(() => {});
    };
    loadAvatar();
    const interval = window.setInterval(loadAvatar, 15_000);
    window.addEventListener('focus', loadAvatar);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', loadAvatar);
    };
  }, [isStella, overlayTenant]);

  useEffect(() => {
    if (isStella) return;
    let ws: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;
    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        ws.onclose = () => { reconnect = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'update-avatar-settings') {
              const p = msg.payload;
              if (p.displayMode) {
                const always = p.displayMode === 'always';
                setAlwaysShow(always);
                if (always) setVisible(true);
                else if (!playing) setVisible(false);
              }
              setAvatar(prev => prev ? { ...prev, ...p } : prev);
            }
          } catch {}
        };
      } catch { reconnect = setTimeout(connect, 3000); }
    };
    connect();
    return () => { clearTimeout(reconnect); ws?.close(); };
  }, [isStella, playing]);

  useEffect(() => {
    let isPlaying = false;
    const cursorKey = `streamweaver:tts-cursor:${overlayTenant || 'global'}`;
    let cursor = '';
    let initialized = false;

    const clearCaptionTimers = () => {
      if (captionTypeTimer.current) clearInterval(captionTypeTimer.current);
      if (captionLingerTimer.current) clearTimeout(captionLingerTimer.current);
      if (captionClearTimer.current) clearTimeout(captionClearTimer.current);
      captionTypeTimer.current = null;
      captionLingerTimer.current = null;
      captionClearTimer.current = null;
    };

    const hideCaptionAfterLinger = () => {
      if (captionLingerTimer.current) clearTimeout(captionLingerTimer.current);
      captionLingerTimer.current = setTimeout(() => {
        setCaptionVisible(false);
        captionClearTimer.current = setTimeout(() => setCaptionText(''), 750);
      }, 10_000);
    };

    const typeCaption = (text: string, durationSeconds?: number) => {
      clearCaptionTimers();
      const clean = String(text || '').trim();
      if (!clean) {
        setCaptionText('');
        setCaptionVisible(false);
        return;
      }
      setCaptionText('');
      setCaptionVisible(true);
      let index = 0;
      const durationMs = Number.isFinite(durationSeconds) && Number(durationSeconds) > 0
        ? Number(durationSeconds) * 1000
        : Math.max(1400, clean.length * 34);
      const stepMs = Math.max(18, Math.min(70, Math.floor(durationMs / Math.max(1, clean.length))));
      captionTypeTimer.current = setInterval(() => {
        index = Math.min(clean.length, index + 1);
        setCaptionText(clean.slice(0, index));
        if (index >= clean.length && captionTypeTimer.current) {
          clearInterval(captionTypeTimer.current);
          captionTypeTimer.current = null;
        }
      }, stepMs);
    };

    const skipQueuedAudio = async () => {
      try {
        const sep = tenantQuery ? `&${tenantQuery}` : '';
        const res = await fetch(`/api/tts/current?latest=1${sep}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          cursor = data.cursor ? String(data.cursor) : '';
          if (cursor) window.localStorage.setItem(cursorKey, cursor);
        }
      } catch {}
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute('src');
        audio.load();
      }
      isPlaying = false;
      setPlaying(false);
      stellaControllerRef.current?.stopTalking();
      setStatus('Skipped queued TTS. Listening for new messages...');
    };

    const playTTS = async (audioUrl: string, text?: string, gesture?: AvatarGestureName | null): Promise<boolean> => {
      const audio = audioRef.current;
      if (!audio) return false;
      audio.src = audioUrl;
      audio.muted = false;
      audio.volume = 1.0;
      audio.preload = 'auto';
      try { await applySavedSink(audio); } catch {}
      audio.load();
      try {
        stellaControllerRef.current?.startTalking(gesture);
        await audio.play();
        typeCaption(text || '', Number.isFinite(audio.duration) ? audio.duration : undefined);
        setStatus('Playing...');
        return true;
      } catch (err: any) {
        stellaControllerRef.current?.stopTalking();
        setStatus(`Click overlay to play: ${err?.message || 'browser blocked autoplay'}`);
        isPlaying = false;
        return false;
      }
    };

    const fetchNext = async () => {
      if (isPlaying || !initialized) return;
      try {
        const sep = tenantQuery ? `&${tenantQuery}` : '';
        const after = cursor ? `&after=${encodeURIComponent(cursor)}` : '';
        const res = await fetch(`/api/tts/current?next=1${after}${sep}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.audioUrl) {
          isPlaying = true;
          const started = await playTTS(data.audioUrl, data.text || '', data.gesture || null);
          if (started && data.cursor) {
            cursor = String(data.cursor);
            window.localStorage.setItem(cursorKey, cursor);
          }
        }
      } catch {}
    };

    const audio = audioRef.current;
    const onEnded = () => {
      isPlaying = false;
      setPlaying(false);
      stellaControllerRef.current?.stopTalking();
      setStatus('Listening for TTS...');
      hideCaptionAfterLinger();
      fetchNext();
    };
    const onError = () => {
      isPlaying = false;
      setPlaying(false);
      stellaControllerRef.current?.stopTalking();
      setStatus('Listening for TTS...');
      hideCaptionAfterLinger();
    };
    const onPause = () => {
      if (!audio || audio.ended) return;
      isPlaying = false;
      setPlaying(false);
      stellaControllerRef.current?.stopTalking();
      const duration = Number.isFinite(audio.duration) ? audio.duration.toFixed(1) : '?';
      setStatus(`Paused at ${audio.currentTime.toFixed(1)}s / ${duration}s - click overlay to resume`);
    };

    if (audio) {
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      audio.addEventListener('pause', onPause);
    }
    window.addEventListener('streamweaver:skip-tts', skipQueuedAudio);
    const interval = setInterval(fetchNext, 500);
    skipQueuedAudio().finally(() => {
      initialized = true;
      fetchNext();
    });
    return () => {
      clearInterval(interval);
      if (audio) {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        audio.removeEventListener('pause', onPause);
      }
      window.removeEventListener('streamweaver:skip-tts', skipQueuedAudio);
      clearCaptionTimers();
    };
  }, [overlayTenant, tenantQuery]);

  useEffect(() => {
    if (isStella) {
      setVisible(true);
      return;
    }
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (alwaysShow) {
      setVisible(true);
      return;
    }
    if (playing) setVisible(true);
    else if (visible) hideTimer.current = setTimeout(() => setVisible(false), 30000);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [playing, alwaysShow, isStella, visible]);

  const renderLegacyAvatar = () => {
    if (!avatar) return null;
    const url = playing ? avatar.talkingUrl : avatar.idleUrl;
    if (avatar.animationType === 'mp4') {
      return <video key={url} src={url} autoPlay loop muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
    }
    if (avatar.animationType === 'gif') {
      return <img key={url} src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
    }
    return null;
  };

  return (
    <div
      onClick={() => {
        const audio = audioRef.current;
        if (!audio || !audio.paused) return;
        audio.play().then(() => {
          stellaControllerRef.current?.startTalking();
          setStatus('Playing...');
        }).catch((err) => setStatus(`Play failed: ${err?.message || 'browser blocked playback'}`));
      }}
      style={{ width: '100%', height: '100vh', background: 'transparent', position: 'relative', overflow: 'hidden' }}
    >
      <audio ref={audioRef} playsInline onPlay={() => { setPlaying(true); setStatus('Playing...'); }} />
      {showControls && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            window.dispatchEvent(new CustomEvent('streamweaver:skip-tts'));
          }}
          style={{ position: 'absolute', right: 8, bottom: 18, zIndex: 5, padding: '4px 7px', border: '1px solid rgba(255,255,255,.35)', borderRadius: 4, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 11, cursor: 'pointer' }}
        >Skip TTS</button>
      )}

      {(isStella || avatar) && (
        <div style={{
          position: 'absolute',
          bottom: loungePlacement ? 115 : 0,
          left: loungePlacement ? -35 : 0,
          width: loungePlacement ? 210 : 300,
          height: loungePlacement ? 210 : 300,
          transition: 'opacity 0.5s', opacity: visible ? 1 : 0,
          pointerEvents: 'none',
        }}>
          {isStella ? <StellaAvatar controllerRef={stellaControllerRef} /> : renderLegacyAvatar()}
        </div>
      )}

      <div style={{
        position: 'absolute',
        left: loungePlacement ? '23%' : 320,
        right: loungePlacement ? '29%' : '5vw',
        bottom: loungePlacement ? '32%' : 54,
        minHeight: loungePlacement ? 0 : 56,
        maxHeight: loungePlacement ? '3.45em' : undefined,
        overflow: loungePlacement ? 'hidden' : 'visible',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-start',
        pointerEvents: 'none',
        opacity: captionVisible ? 1 : 0,
        transition: 'opacity 0.7s ease',
      }}>
        <div style={{
          maxWidth: loungePlacement ? '100%' : 'min(1080px, 78vw)',
          color: '#ffd900',
          fontFamily: 'Arial Black, Inter, system-ui, sans-serif',
          fontWeight: 900,
          fontSize: loungePlacement ? 'clamp(16px, 2vw, 24px)' : 'clamp(24px, 2.4vw, 48px)',
          lineHeight: 1.16,
          letterSpacing: '0.01em',
          textAlign: 'left',
          textWrap: 'balance',
          WebkitTextStroke: '1px rgba(0,0,0,.9)',
          textShadow: '0 3px 3px #000, 0 0 8px #000, 0 0 18px rgba(0,0,0,.9)',
          ...(loungePlacement ? {
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical' as const,
            WebkitLineClamp: 3,
            overflow: 'hidden',
          } : {}),
        }}>
          {captionText}
        </div>
      </div>
      {loungePlacement ? <LoungeAttributionMarquee /> : (
        <div style={{ position: 'absolute', bottom: 2, right: 4, fontSize: 10, color: '#444', fontFamily: 'sans-serif' }}>
          {status}
        </div>
      )}
    </div>
  );
}
