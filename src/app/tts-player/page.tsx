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

export default function TTSPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState('Listening for TTS...');
  const [playing, setPlaying] = useState(false);
  const [avatar, setAvatar] = useState<AvatarSettings | null>(null);
  const [alwaysShow, setAlwaysShow] = useState(false);
  const hideTimer = useRef<NodeJS.Timeout | null>(null);
  const [visible, setVisible] = useState(false);
  const overlayTenant = getOverlayTenantId();
  const tenantQuery = overlayTenant ? `tenant=${encodeURIComponent(overlayTenant)}` : '';

  // Load avatar settings from server
  useEffect(() => {
    const suffix = overlayTenant ? `&tenant=${encodeURIComponent(overlayTenant)}` : '';
    fetch(`/api/avatars?type=settings${suffix}`)
      .then(r => r.ok ? r.json() : null)
      .then(payload => {
        const d = payload?.data;
        if (!d?.idleFile) return;
        const t = (d.animationType === 'json' ? 'lottie' : d.animationType) as AvatarSettings['animationType'];
        setAvatar({
          animationType: t,
          idleUrl: `/api/avatars?type=idle&format=${t}${suffix}`,
          talkingUrl: d.talkingFile ? `/api/avatars?type=talking&format=${t}${suffix}` : `/api/avatars?type=idle&format=${t}${suffix}`,
          displayMode: d.displayMode || 'auto',
        });
        if (d.displayMode === 'always') {
          setAlwaysShow(true);
          setVisible(true);
        }
      })
      .catch(() => {});
  }, [overlayTenant]);

  // WebSocket for live setting updates
  useEffect(() => {
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
  }, []);

  // Poll for TTS audio queue — plays items sequentially without cutting off
  useEffect(() => {
    let isPlaying = false;

    const playTTS = async (audioUrl: string) => {
      const audio = audioRef.current;
      if (!audio) return;

      audio.src = audioUrl;
      audio.muted = true;
      try { await applySavedSink(audio); } catch {}

      try {
        await audio.play();
        audio.muted = false;
        audio.volume = 1.0;
        setStatus('Playing...');
      } catch (err: any) {
        audio.muted = false;
        audio.volume = 1.0;
        try {
          await audio.play();
          setStatus('Playing...');
        } catch {
          setStatus(`Play failed: ${err.message}`);
          isPlaying = false;
        }
      }
    };

    const fetchNext = async () => {
      if (isPlaying) return;
      try {
        const sep = tenantQuery ? `&${tenantQuery}` : '';
        const res = await fetch(`/api/tts/current?next=1${sep}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.audioUrl) {
          isPlaying = true;
          await playTTS(data.audioUrl);
        }
      } catch {}
    };

    const audio = audioRef.current;
    const onEnded = () => {
      isPlaying = false;
      setPlaying(false);
      setStatus('Listening for TTS...');
      // Immediately check for next queued item
      fetchNext();
    };
    const onError = () => {
      isPlaying = false;
      setPlaying(false);
      setStatus('Listening for TTS...');
    };

    if (audio) {
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
    }

    const interval = setInterval(fetchNext, 500);
    return () => {
      clearInterval(interval);
      if (audio) {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
      }
    };
  }, [overlayTenant, tenantQuery]);

  // Show avatar when playing, hide after idle (only in auto mode)
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
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [playing, alwaysShow]);

  const renderAvatar = () => {
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
    <div style={{ width: '100%', height: '100vh', background: 'transparent', position: 'relative', overflow: 'hidden' }}>
      <audio
        ref={audioRef}
        onPlay={() => { setPlaying(true); setStatus('Playing...'); }}
      />
      {/* Avatar */}
      {avatar && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, width: 300, height: 300,
          transition: 'opacity 0.5s', opacity: visible ? 1 : 0,
          pointerEvents: 'none',
        }}>
          {renderAvatar()}
        </div>
      )}
      {/* Status (tiny, invisible in OBS) */}
      <div style={{ position: 'absolute', bottom: 2, right: 4, fontSize: 10, color: '#444', fontFamily: 'sans-serif' }}>
        {status}
      </div>
    </div>
  );
}
