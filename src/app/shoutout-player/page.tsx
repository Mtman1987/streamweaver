'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';
import { useLoungeBroadcastVolume } from '@/lib/lounge-broadcast-volume';

export default function ShoutoutPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const spotlightLevel = useLoungeBroadcastVolume('spotlight');
  const spotlightLevelRef = useRef<number | null>(null);
  useEffect(() => {
    spotlightLevelRef.current = spotlightLevel;
    if (videoRef.current && spotlightLevel !== null) videoRef.current.volume = spotlightLevel;
  }, [spotlightLevel]);
  const websocketRef = useRef<WebSocket | null>(null);
  const activeEventIdRef = useRef<string>('');
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackDurationRef = useRef(30);
  const fallbackEmbedUrlRef = useRef('');
  const fallbackStartedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [fallbackEmbedUrl, setFallbackEmbedUrl] = useState('');

  const acknowledgePlayback = (eventId: string, phase: 'started' | 'ended' | 'failed') => {
    if (!eventId || websocketRef.current?.readyState !== WebSocket.OPEN) return;
    websocketRef.current.send(JSON.stringify({
      type: 'shoutout-clip-playback',
      payload: { eventId, phase },
    }));
  };

  const finishPlayback = () => {
    const completedEventId = activeEventIdRef.current;
    acknowledgePlayback(completedEventId, 'ended');
    activeEventIdRef.current = '';
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    fallbackEmbedUrlRef.current = '';
    fallbackStartedRef.current = false;
    setTimeout(() => {
      if (activeEventIdRef.current && activeEventIdRef.current !== completedEventId) return;
      if (videoRef.current) videoRef.current.src = '';
      setFallbackEmbedUrl('');
      setVisible(false);
    }, 500);
  };

  const playClip = async (eventId: string, clipUrl: string, thumbnailUrl: string, user: string, profileImage: string, duration = 30) => {
    if (eventId && activeEventIdRef.current === eventId) {
      // The server replays an active clip on reconnect. Keep its current time
      // and repeat the acknowledgement if the prior socket closed mid-send.
      if ((videoRef.current && !videoRef.current.paused) || fallbackStartedRef.current) {
        acknowledgePlayback(eventId, 'started');
      }
      return;
    }
    setError(null);
    setFallbackEmbedUrl('');
    fallbackEmbedUrlRef.current = '';
    fallbackStartedRef.current = false;
    activeEventIdRef.current = eventId;
    let match = clipUrl.match(/clip=([^&]+)/);
    if (!match) {
      // Try treating clipUrl as a direct slug/URL
      const slugMatch = clipUrl.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/\w+\/clip\/)([^?&/]+)/);
      if (!slugMatch) { setError('Invalid clip URL'); acknowledgePlayback(eventId, 'failed'); return; }
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
        }),
        signal: AbortSignal.timeout(4_000),
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
        if (spotlightLevelRef.current !== null) video.volume = spotlightLevelRef.current;
        video.load();
        setVisible(true);
        try {
          // OBS browser sources permit autoplay with audio in normal operation.
          await video.play();
        } catch {
          // The direct clip could not play. Use the existing Twitch embed fallback.
          throw new Error('Direct clip playback blocked');
        }
        acknowledgePlayback(eventId, 'started');
      }
    } catch (err: any) {
      console.error('[Shoutout] Clip load failed:', err);
      // Twitch occasionally changes its direct-media lookup. Its supported
      // clip embed remains the reliable fallback for OBS browser sources.
      const parent = window.location.hostname;
      fallbackDurationRef.current = Math.max(1, duration);
      const fallbackUrl = `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clipId)}&parent=${encodeURIComponent(parent)}&autoplay=true&muted=false`;
      fallbackEmbedUrlRef.current = fallbackUrl;
      setFallbackEmbedUrl(fallbackUrl);
      setVisible(true);
    }
  };

  const handleEnded = finishPlayback;

  // Listen for shoutout events via WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;
    let syncTimer: ReturnType<typeof setInterval>;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        websocketRef.current = ws;
        ws.onopen = () => {
          ws?.send(JSON.stringify({ type: 'shoutout-clip-sync' }));
          syncTimer = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'shoutout-clip-sync' }));
          }, 4000);
        };
        ws.onclose = () => {
          clearInterval(syncTimer);
          if (stopped) return;
          if (websocketRef.current === ws) websocketRef.current = null;
          reconnect = setTimeout(connect, 1000);
        };
        ws.onerror = () => { console.warn('[Shoutout] Overlay WebSocket disconnected'); };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'shoutout-play-clip') {
              const { eventId, clipUrl, thumbnailUrl, user, profileImage, duration } = msg.payload;
              playClip(eventId, clipUrl, thumbnailUrl, user, profileImage, duration);
            }
          } catch {}
        };
      } catch {
        reconnect = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnect);
      clearInterval(syncTimer);
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      ws?.close();
      websocketRef.current = null;
    };
  }, []);

  // Also support legacy URL-param mode (for OBS WebSocket setBrowserSource)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const video = params.get('video');
    const thumb = params.get('thumbnail_url');
    const user = params.get('user') || '';
    const image = params.get('image') || '';
    if (video && thumb) {
      playClip('', video, thumb, user, image);
    }
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', background: 'transparent' }}>
      <video
        ref={videoRef}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain',
          visibility: visible ? 'visible' : 'hidden'
        }}
        autoPlay
        onEnded={handleEnded}
      />
      {fallbackEmbedUrl && (
        <iframe
          key={`${fallbackEmbedUrl}:${spotlightLevel === 0}`}
          src={fallbackEmbedUrl.replace('muted=false', `muted=${spotlightLevel === 0}`)}
          title="Twitch shoutout clip"
          allow="autoplay; fullscreen"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: visible ? 'block' : 'none' }}
          onLoad={() => {
            fallbackStartedRef.current = true;
            acknowledgePlayback(activeEventIdRef.current, 'started');
            if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = setTimeout(finishPlayback, fallbackDurationRef.current * 1000);
          }}
        />
      )}
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
