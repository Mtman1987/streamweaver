'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';

export default function ShoutoutPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const playClip = async (clipUrl: string, thumbnailUrl: string, user: string, profileImage: string) => {
    setError(null);
    let match = clipUrl.match(/clip=([^&]+)/);
    if (!match) {
      // Try treating clipUrl as a direct slug/URL
      const slugMatch = clipUrl.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/\w+\/clip\/)([^?&/]+)/);
      if (!slugMatch) { setError('Invalid clip URL'); return; }
      match = slugMatch;
    }

    const clipId = match[1].split('/').pop()!;

    try {
      const response = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko'
        },
        body: JSON.stringify({
          operationName: 'VideoAccessToken_Clip',
          variables: { platform: 'web', slug: clipId },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: '6fd3af2b22989506269b9ac02dd87eb4a6688392d67d94e41a6886f1e9f5c00f'
            }
          }
        })
      });

      if (!response.ok) throw new Error(`GraphQL failed: ${response.status}`);
      const clipInfo = await response.json();
      const clipData = clipInfo.data?.clip;
      if (!clipData?.videoQualities?.[0]?.sourceURL) throw new Error('No video source');

      const src = `${clipData.videoQualities[0].sourceURL}?sig=${clipData.playbackAccessToken.signature}&token=${encodeURIComponent(clipData.playbackAccessToken.value)}`;

      if (videoRef.current) {
        const video = videoRef.current;
        video.src = src;
        video.muted = false;
        video.load();
        setVisible(true);
        try {
          // OBS browser sources permit autoplay with audio in normal operation.
          await video.play();
        } catch {
          // Regular browsers may block unmuted autoplay. Keep the clip moving
          // instead of leaving a fully loaded video paused on its first frame.
          video.muted = true;
          await video.play();
        }
      }
    } catch (err: any) {
      console.error('[Shoutout] Clip load failed:', err);
      setError(err.message);
      setTimeout(() => { setError(null); setVisible(false); }, 5000);
    }
  };

  const handleEnded = () => {
    setTimeout(() => {
      if (videoRef.current) videoRef.current.src = '';
      setVisible(false);
    }, 500);
  };

  // Listen for shoutout events via WebSocket
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
            if (msg.type === 'shoutout-play-clip') {
              const { clipUrl, thumbnailUrl, user, profileImage } = msg.payload;
              playClip(clipUrl, thumbnailUrl, user, profileImage);
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

  // Also support legacy URL-param mode (for OBS WebSocket setBrowserSource)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const video = params.get('video');
    const thumb = params.get('thumbnail_url');
    const user = params.get('user') || '';
    const image = params.get('image') || '';
    if (video && thumb) {
      playClip(video, thumb, user, image);
    }
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', background: 'transparent' }}>
      <video
        ref={videoRef}
        style={{
          width: '100%', height: '100%', objectFit: 'contain',
          visibility: visible ? 'visible' : 'hidden'
        }}
        autoPlay
        onEnded={handleEnded}
      />
      {error && (
        <div style={{
          position: 'absolute', top: 10, left: 10,
          background: 'rgba(255,0,0,0.8)', color: 'white',
          padding: 10, borderRadius: 5, zIndex: 100, fontSize: 14
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
