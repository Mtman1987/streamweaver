'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';

export default function BRBPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [clipUser, setClipUser] = useState('');
  const [spotlight, setSpotlight] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;

    const playClip = async (clipUrl: string, thumbnailUrl: string) => {
      const match = clipUrl.match(/clip=([^&]+)/);
      if (!match) { setActive(false); return; }
      const clipId = match[1].split('/').pop()!;

      try {
        const response = await fetch('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
          body: JSON.stringify({
            operationName: 'VideoAccessToken_Clip',
            variables: { platform: 'web', slug: clipId },
            extensions: { persistedQuery: { version: 1, sha256Hash: '6fd3af2b22989506269b9ac02dd87eb4a6688392d67d94e41a6886f1e9f5c00f' } }
          })
        });

        if (!response.ok) throw new Error(`Clip lookup failed: ${response.status}`);
        const clipInfo = await response.json();
        const clipData = clipInfo.data?.clip;
        if (!clipData?.videoQualities?.[0]?.sourceURL) throw new Error('Clip source unavailable');

        const src = `${clipData.videoQualities[0].sourceURL}?sig=${clipData.playbackAccessToken.signature}&token=${encodeURIComponent(clipData.playbackAccessToken.value)}`;

        if (videoRef.current) {
          videoRef.current.src = src;
          videoRef.current.muted = true;
          videoRef.current.load();
          videoRef.current.play().then(() => {
            setSpotlight(false);
            setActive(true);
            if (videoRef.current) videoRef.current.muted = false;
          }).catch(err => { console.warn('[BRB] Clip playback failed:', err); setActive(false); });
        }
      } catch (err) {
        console.error('[BRB] Clip load failed:', err);
        setActive(false);
      }
    };

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        ws.onclose = () => { reconnect = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'brb-start') {
              setActive(false);
              setSpotlight(false);
            }
            if (msg.type === 'brb-clip' && msg.payload) {
              setClipUser(msg.payload.user || '');
              playClip(msg.payload.clipUrl, msg.payload.thumbnailUrl);
            }
            if (msg.type === 'brb-spotlight') {
              if (videoRef.current) videoRef.current.src = '';
              setClipUser('');
              setSpotlight(true);
              setActive(true);
            }
            if (msg.type === 'brb-no-media' || msg.type === 'brb-stop') {
              setActive(false);
              setSpotlight(false);
              if (videoRef.current) videoRef.current.src = '';
            }
          } catch {}
        };
      } catch {
        reconnect = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { clearTimeout(reconnect); ws?.close(); };
  }, []);

  return (
    <div style={{
      width: '100vw', height: '100vh', background: active ? '#0e0e10' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative'
    }}>
      <video
        ref={videoRef}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: spotlight ? 'none' : 'block' }}
        autoPlay
      />
      {active && spotlight && (
        <iframe
          src="https://hearmeout-main.fly.dev/spotlight-media/player?v=live-spotlight-3"
          title="Live Community Spotlight"
          allow="autoplay; fullscreen"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      )}
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
