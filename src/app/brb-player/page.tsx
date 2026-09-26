'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';

export default function BRBPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [clipUser, setClipUser] = useState('');
  const [spotlight, setSpotlight] = useState(false);
  const [gifUrl, setGifUrl] = useState('');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;
    let stopped = false;
    let manual = false;
    let automatic = false;
    let autoTimer: ReturnType<typeof setTimeout>;
    let autoStartedAt = 0;
    let autoIndex = 0;
    let autoPlaylist: { clips: any[]; gifs: { url: string; user: string }[] } = { clips: [], gifs: [] };
    let playbackEpoch = 0;
    let lastGif: { url: string; user: string } | undefined;

    const showGif = (gif?: { url: string; user: string }) => {
      if (!gif?.url) { setActive(false); notifyParent(false); return; }
      videoRef.current?.pause();
      setClipUser(gif.user || '');
      setGifUrl(gif.url);
      setSpotlight(false);
      setActive(true);
      notifyParent(true, 'clip');
    };

    const playClip = async (clipUrl: string, thumbnailUrl: string, fallback?: { url: string; user: string }) => {
      const epoch = ++playbackEpoch;
      lastGif = fallback;
      setGifUrl('');
      const match = clipUrl.match(/clip=([^&]+)/);
      if (!match) { showGif(fallback); return; }
      const clipId = match[1].split('/').pop()!;

      try {
        const response = await fetch('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
          signal: AbortSignal.timeout(5_000),
          body: JSON.stringify({
            operationName: 'VideoAccessToken_Clip',
            variables: { platform: 'web', slug: clipId },
            extensions: { persistedQuery: { version: 1, sha256Hash: '6fd3af2b22989506269b9ac02dd87eb4a6688392d67d94e41a6886f1e9f5c00f' } }
          })
        });

        if (!response.ok) throw new Error(`Clip lookup failed: ${response.status}`);
        const clipInfo = await response.json();
        if (epoch !== playbackEpoch || stopped) return;
        const clipData = clipInfo.data?.clip;
        if (!clipData?.videoQualities?.[0]?.sourceURL) throw new Error('Clip source unavailable');

        const src = `${clipData.videoQualities[0].sourceURL}?sig=${clipData.playbackAccessToken.signature}&token=${encodeURIComponent(clipData.playbackAccessToken.value)}`;

        if (videoRef.current) {
          videoRef.current.src = src;
          videoRef.current.muted = true;
          videoRef.current.load();
          videoRef.current.play().then(() => {
            if (epoch !== playbackEpoch || stopped) return;
            setSpotlight(false);
            setGifUrl('');
            setActive(true);
            if (videoRef.current) videoRef.current.muted = false;
          }).catch((err: unknown) => { console.warn('[BRB] Clip playback failed:', err); if (epoch === playbackEpoch) showGif(fallback); });
        }
      } catch (err) {
        console.error('[BRB] Clip load failed:', err);
        if (epoch === playbackEpoch) showGif(fallback);
      }
    };

    const notifyParent = (on: boolean, mode: 'clip' | 'spotlight' = 'clip') => {
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'spmt-lounge-brb-audio', active: on, mode }, 'https://spmt.live');
      }
    };

    const stopAutomatic = () => {
      automatic = false;
      clearTimeout(autoTimer);
      playbackEpoch++;
      videoRef.current?.pause();
      setGifUrl('');
      setActive(false);
      notifyParent(false);
    };

    const nextAutomatic = async () => {
      if (!automatic || manual || stopped) return;
      if (Date.now() - autoStartedAt >= 10 * 60_000 || (!autoPlaylist.clips.length && !autoPlaylist.gifs.length)) {
        try {
          const response = await fetch('/api/lounge/brb-fallback?tenant=spacemountainlive', {
            cache: 'no-store', signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error(`BRB playlist ${response.status}`);
          const data = await response.json();
          if (!automatic || manual || stopped) return;
          autoPlaylist = {
            clips: Array.isArray(data.clips) ? data.clips : [],
            gifs: Array.isArray(data.gifs) ? data.gifs : [],
          };
          autoIndex = 0;
          autoStartedAt = Date.now();
        } catch (error) {
          console.warn('[BRB] Playlist lookup failed:', error);
          autoStartedAt = Date.now() - 10 * 60_000 + 15_000;
        }
      }
      if (!automatic || manual || stopped) return;
      const clip = autoPlaylist.clips.length ? autoPlaylist.clips[autoIndex % autoPlaylist.clips.length] : null;
      const gif = autoPlaylist.gifs.length ? autoPlaylist.gifs[autoIndex % autoPlaylist.gifs.length] : undefined;
      autoIndex++;
      if (clip) {
        setClipUser(clip.user || '');
        void playClip(clip.clipUrl, clip.thumbnailUrl || '', gif);
      } else {
        showGif(gif);
      }
      autoTimer = setTimeout(() => { void nextAutomatic(); },
        clip ? Math.max(5_000, Number(clip.duration) || 30_000) : 12_000);
    };

    const onSpotlightHealth = (event: MessageEvent) => {
      if (event.origin !== 'https://spmt.live' || event.source !== window.parent
          || event.data?.type !== 'spmt-lounge-spotlight-health') return;
      if (event.data.healthy === true) {
        if (automatic) stopAutomatic();
      } else if (event.data.healthy === false && !automatic && !manual) {
        automatic = true;
        autoStartedAt = 0;
        void nextAutomatic();
      }
    };
    window.addEventListener('message', onSpotlightHealth);
    const onVideoError = () => { if (lastGif) showGif(lastGif); };
    videoRef.current?.addEventListener('error', onVideoError);

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        ws.onclose = () => { if (stopped) return; if (manual) { setActive(false); notifyParent(false); } reconnect = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'brb-start') {
              if (automatic) stopAutomatic();
              manual = true;
              setActive(false);
              setSpotlight(false);
              notifyParent(false);
            }
            if (msg.type === 'brb-clip' && msg.payload) {
              manual = true;
              setClipUser(msg.payload.user || '');
              notifyParent(true, 'clip');
              playClip(msg.payload.clipUrl, msg.payload.thumbnailUrl, msg.payload.gifUrl ? { url: msg.payload.gifUrl, user: msg.payload.user } : undefined);
            }
            if (msg.type === 'brb-gif' && msg.payload) {
              manual = true;
              playbackEpoch++;
              showGif(msg.payload);
            }
            if (msg.type === 'brb-no-media' || msg.type === 'brb-stop') {
              if (msg.type === 'brb-stop') manual = false;
              playbackEpoch++;
              setGifUrl('');
              setActive(false);
              setSpotlight(false);
              notifyParent(false);
              if (videoRef.current) videoRef.current.src = '';
            }
          } catch {}
        };
      } catch {
        reconnect = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { stopped = true; clearTimeout(reconnect); clearTimeout(autoTimer); ws?.close(); window.removeEventListener('message', onSpotlightHealth); videoRef.current?.removeEventListener('error', onVideoError); notifyParent(false); };
  }, []);

  return (
    <div style={{
      width: '100vw', height: '100vh', background: active && !spotlight ? '#0e0e10' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative'
    }}>
      <video
        ref={videoRef}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: spotlight || gifUrl ? 'none' : 'block' }}
        autoPlay
      />
      {active && gifUrl && <img onError={() => { setGifUrl(''); setActive(false); if (window.parent !== window) window.parent.postMessage({ type: 'spmt-lounge-brb-audio', active: false, mode: 'clip' }, 'https://spmt.live'); }} src={gifUrl} alt={clipUser ? `${clipUser}'s community GIF` : 'Community GIF'} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />}
      {active && spotlight && (
        <div style={{ position: 'absolute', top: 18, left: 20, zIndex: 2, padding: '8px 14px', borderRadius: 9,
          background: 'rgba(5,12,30,.83)', border: '1px solid rgba(103,232,249,.65)',
          color: '#e8fbff', font: '700 16px system-ui, sans-serif', pointerEvents: 'none' }}>
          BRB - Community Spotlight
        </div>
      )}
      {active && !spotlight && clipUser && (
        <div style={{
          position: 'absolute', bottom: 20, left: 20,
          background: 'rgba(0,0,0,0.7)', color: 'white',
          padding: '8px 16px', borderRadius: 8, fontSize: 18,
          fontFamily: 'system-ui, sans-serif'
        }}>
          📹 {clipUser}
        </div>
      )}
    </div>
  );
}
