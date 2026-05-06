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
  const lastUrlRef = useRef<string>('');
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Click to enable TTS playback');
  const [playing, setPlaying] = useState(false);
  const [avatar, setAvatar] = useState<AvatarSettings | null>(null);
  const [alwaysShow, setAlwaysShow] = useState(false);
  const hideTimer = useRef<NodeJS.Timeout | null>(null);
  const [visible, setVisible] = useState(false);
  const overlayTenant = getOverlayTenantId();
  const tenantQuery = overlayTenant ? `tenant=${encodeURIComponent(overlayTenant)}` : '';
  const tenantPrefix = tenantQuery ? `?${tenantQuery}` : '';

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
                setVisible(always);
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

  // Poll for TTS audio
  useEffect(() => {
    if (!enabled) return;
    const check = async () => {
      try {
        const pollPath = `/api/tts/current?poll=1${tenantQuery ? `&${tenantQuery}` : ''}`;
        const fullPath = `/api/tts/current${tenantPrefix}`;
        const pollRes = await fetch(pollPath);
        if (!pollRes.ok) return;
        const pollData = await pollRes.json();
        if (!pollData.updatedAt || pollData.updatedAt === lastUrlRef.current) return;

        const fullRes = await fetch(fullPath);
        if (!fullRes.ok) return;
        const data = await fullRes.json();
        if (data.audioUrl && data.updatedAt) {
          lastUrlRef.current = data.updatedAt;
          if (audioRef.current) {
            audioRef.current.src = data.audioUrl;
            audioRef.current.volume = 1.0;
            try { await applySavedSink(audioRef.current); } catch {}
            audioRef.current.play()
              .then(() => setStatus('Playing...'))
              .catch(err => setStatus(`Play failed: ${err.message}`));
          }
        }
      } catch {}
    };
    const interval = setInterval(check, 500);
    return () => clearInterval(interval);
  }, [enabled, overlayTenant, tenantPrefix, tenantQuery]);

  // Show avatar when playing, hide after idle
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (playing) {
      setVisible(true);
    } else if (!alwaysShow && visible) {
      // Hide after 30s of silence
      hideTimer.current = setTimeout(() => setVisible(false), 30000);
    }
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [playing, alwaysShow, visible]);

  const handleEnable = () => {
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

  if (!enabled) {
    return (
      <div onClick={handleEnable} style={{
        width: '100%', height: '100vh', background: 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontFamily: 'sans-serif', color: '#888',
      }}>
        <audio ref={audioRef} />
        <span>🔊 Click anywhere to enable TTS</span>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100vh', background: 'transparent', position: 'relative', overflow: 'hidden' }}>
      <audio
        ref={audioRef}
        onPlay={() => { setPlaying(true); setStatus('Playing...'); }}
        onEnded={() => { setPlaying(false); setStatus('Listening for TTS...'); }}
        onPause={() => { setPlaying(false); }}
        onError={() => { setPlaying(false); setStatus('Listening for TTS...'); }}
      />
      {/* Avatar */}
      {avatar && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, width: 300, height: 300,
          transition: 'opacity 0.5s', opacity: visible ? 1 : 0,
        }}>
          {renderAvatar()}
        </div>
      )}
      {/* Status (tiny, bottom-right, mostly invisible in OBS) */}
      <div style={{ position: 'absolute', bottom: 2, right: 4, fontSize: 10, color: '#444', fontFamily: 'sans-serif' }}>
        {status}
      </div>
    </div>
  );
}
