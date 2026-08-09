'use client';

import { useEffect, useRef, useState } from 'react';
import { applySavedSink } from '@/services/audio-sink';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';

type AvatarSettings = {
  animationType: 'mp4' | 'gif' | 'lottie';
  idleUrl: string;
  talkingUrl: string;
  displayMode: string;
};

export default function TTSListenerPage() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState('Muted. Click Enable Voice to listen.');
  const [playing, setPlaying] = useState(false);
  const [avatar, setAvatar] = useState<AvatarSettings | null>(null);
  const [alwaysShow, setAlwaysShow] = useState(false);
  const [visible, setVisible] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const hideTimer = useRef<NodeJS.Timeout | null>(null);
  const overlayTenant = getOverlayTenantId();
  const tenantQuery = overlayTenant ? `tenant=${encodeURIComponent(overlayTenant)}` : '';

  useEffect(() => {
    if (!overlayTenant) return;
    const heartbeat = () => {
      fetch('/api/tts/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: overlayTenant, kind: 'listener' }),
        keepalive: true,
      }).catch(() => {});
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 10_000);
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') heartbeat();
    };
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
    const suffix = overlayTenant ? `&tenant=${encodeURIComponent(overlayTenant)}` : '';
    fetch(`/api/avatars?type=settings${suffix}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        const d = payload?.data;
        if (!d?.idleFile && !d?.idleUrl) return;
        const t = (d.animationType === 'json' ? 'lottie' : d.animationType) as AvatarSettings['animationType'];
        setAvatar({
          animationType: t,
          idleUrl: d.idleUrl || `/api/avatars?type=idle&format=${t}${suffix}`,
          talkingUrl: d.talkingUrl || (d.talkingFile ? `/api/avatars?type=talking&format=${t}${suffix}` : (d.idleUrl || `/api/avatars?type=idle&format=${t}${suffix}`)),
          displayMode: d.displayMode || 'auto',
        });
        if (d.displayMode === 'always') {
          setAlwaysShow(true);
          setVisible(true);
        }
      })
      .catch(() => {});
  }, [overlayTenant]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;
    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        ws.onclose = () => {
          reconnect = setTimeout(connect, 3000);
        };
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
              setAvatar((prev) => (prev ? { ...prev, ...p } : prev));
            }
          } catch {}
        };
      } catch {
        reconnect = setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      clearTimeout(reconnect);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    if (!audioEnabled) {
      setStatus('Muted. Click Enable Voice to listen.');
      return;
    }

    let isPlaying = false;
    const cursorKey = `streamweaver:tts-cursor:${overlayTenant || 'global'}`;
    let cursor = window.localStorage.getItem(cursorKey) || '';

    const playTTS = async (audioUrl: string): Promise<boolean> => {
      const audio = audioRef.current;
      if (!audio) return false;

      audio.src = audioUrl;
      audio.muted = false;
      audio.volume = 1.0;
      audio.preload = 'auto';
      try {
        await applySavedSink(audio);
      } catch {}
      audio.load();

      try {
        await audio.play();
        setStatus('Playing...');
        return true;
      } catch (err: any) {
        setStatus(`Click Enable Voice to continue: ${err?.message || 'browser blocked autoplay'}`);
        isPlaying = false;
        return false;
      }
    };

    const fetchNext = async () => {
      if (isPlaying) return;
      try {
        const sep = tenantQuery ? `&${tenantQuery}` : '';
        const after = cursor ? `&after=${encodeURIComponent(cursor)}` : '';
        const res = await fetch(`/api/tts/current?next=1${after}${sep}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.audioUrl) {
          isPlaying = true;
          const started = await playTTS(data.audioUrl);
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
      setStatus('Listening for TTS...');
      fetchNext();
    };
    const onError = () => {
      isPlaying = false;
      setPlaying(false);
      setStatus('Listening for TTS...');
    };
    const onPause = () => {
      if (!audio || audio.ended) return;
      isPlaying = false;
      setPlaying(false);
      const duration = Number.isFinite(audio.duration) ? audio.duration.toFixed(1) : '?';
      setStatus(`Paused at ${audio.currentTime.toFixed(1)}s / ${duration}s - click Enable Voice to resume`);
    };

    if (audio) {
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      audio.addEventListener('pause', onPause);
    }

    const interval = setInterval(fetchNext, 500);
    fetchNext();
    return () => {
      clearInterval(interval);
      if (audio) {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        audio.removeEventListener('pause', onPause);
      }
    };
  }, [audioEnabled, overlayTenant, tenantQuery]);

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (alwaysShow) {
      setVisible(true);
      return;
    }
    if (playing) {
      setVisible(true);
    } else if (visible) {
      hideTimer.current = setTimeout(() => setVisible(false), 30000);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [playing, alwaysShow]);

  const renderAvatar = () => {
    if (!avatar) return null;
    const url = playing ? avatar.talkingUrl : avatar.idleUrl;
    if (avatar.animationType === 'mp4') {
      return (
        <video
          key={url}
          src={url}
          autoPlay
          loop
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onError={(e) => {
            const el = e.currentTarget;
            if (!el.dataset.fallbackTried && playing && avatar.talkingUrl !== avatar.idleUrl) {
              el.dataset.fallbackTried = '1';
              el.src = avatar.idleUrl;
            }
          }}
        />
      );
    }
    if (avatar.animationType === 'gif') {
      return (
        <img
          key={url}
          src={url}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onError={(e) => {
            const el = e.currentTarget;
            if (!el.dataset.fallbackTried && playing && avatar.talkingUrl !== avatar.idleUrl) {
              el.dataset.fallbackTried = '1';
              el.src = avatar.idleUrl;
            }
          }}
        />
      );
    }
    return null;
  };

  return (
    <div
      onClick={() => {
        if (!audioEnabled) {
          setAudioEnabled(true);
          return;
        }
        const audio = audioRef.current;
        if (!audio || !audio.paused) return;
        audio.play().then(() => setStatus('Playing...')).catch((err) => {
          setStatus(`Play failed: ${err?.message || 'browser blocked playback'}`);
        });
      }}
      style={{ width: '100%', height: '100vh', background: 'transparent', position: 'relative', overflow: 'hidden' }}
    >
      <audio
        ref={audioRef}
        playsInline
        onPlay={() => {
          setPlaying(true);
          setStatus('Playing...');
        }}
      />
      {!audioEnabled && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: '#fff',
            fontFamily: 'sans-serif',
          }}
        >
          <button
            type="button"
            onClick={() => setAudioEnabled(true)}
            style={{
              padding: '14px 20px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.24)',
              background: 'rgba(17,24,39,0.72)',
              color: '#fff',
              fontWeight: 700,
              boxShadow: '0 10px 24px rgba(0,0,0,0.25)',
              cursor: 'pointer',
            }}
          >
            Enable Voice
          </button>
        </div>
      )}
      {avatar && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: 300,
            height: 300,
            transition: 'opacity 0.5s',
            opacity: visible ? 1 : 0,
            pointerEvents: 'none',
          }}
        >
          {renderAvatar()}
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 2, right: 4, fontSize: 10, color: '#444', fontFamily: 'sans-serif' }}>
        {status}
      </div>
    </div>
  );
}
