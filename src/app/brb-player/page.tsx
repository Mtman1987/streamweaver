'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';
import { useLoungeBroadcastVolume } from '@/lib/lounge-broadcast-volume';

const SPONSOR_GIF_BUFFER_SIZE = 15;
const SPONSOR_GIF_DURATION_MS = 12_000;
type SponsorGif = { url: string; user: string };

export default function BRBPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const spotlightLevel = useLoungeBroadcastVolume('spotlight');
  const spotlightLevelRef = useRef<number | null>(null);
  useEffect(() => {
    spotlightLevelRef.current = spotlightLevel;
    if (videoRef.current && spotlightLevel !== null) videoRef.current.volume = spotlightLevel;
  }, [spotlightLevel]);
  const [active, setActive] = useState(false);
  const [clipUser, setClipUser] = useState('');
  const [spotlight, setSpotlight] = useState(false);
  const [testStream, setTestStream] = useState(false);
  const [gifUrl, setGifUrl] = useState('');
  const [embedUrl, setEmbedUrl] = useState('');
  const [videoPlaying, setVideoPlaying] = useState(false);
  const embedLoadedRef = useRef<() => void>(() => {});
  const embedFailedRef = useRef<() => void>(() => {});

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;
    let stopped = false;
    let manual = false;
    let playbackEpoch = 0;
    let embedTimer: ReturnType<typeof setTimeout>;
    let lastGif: { url: string; user: string } | undefined;
    let testTimer: ReturnType<typeof setTimeout>;
    let testGeneration = 0;
    let automatic = false;
    let spotlightHealthy = true;
    let autoStartTimer: ReturnType<typeof setTimeout> | undefined;
    let autoStopTimer: ReturnType<typeof setTimeout>;
    let autoClipTimer: ReturnType<typeof setTimeout>;
    let autoEpoch = 0;

    const showGif = (gif?: { url: string; user: string }) => {
      clearTimeout(embedTimer);
      setEmbedUrl('');
      setVideoPlaying(false);
      lastGif = undefined;
      if (!gif?.url) { videoRef.current?.pause(); setClipUser(''); setGifUrl(''); setActive(true); notifyParent(true, 'gif'); return; }
      videoRef.current?.pause();
      setClipUser(gif.user || '');
      setGifUrl(gif.url);
      setSpotlight(false);
      setActive(true);
      notifyParent(true, 'gif');
    };

    const playEmbed = (clipId: string, epoch: number, fallback?: { url: string; user: string }) => {
      if (epoch !== playbackEpoch || stopped) return;
      const url = `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clipId)}&parent=${encodeURIComponent(window.location.hostname)}&autoplay=true&muted=false`;
      embedLoadedRef.current = () => {
        if (epoch !== playbackEpoch || stopped) return;
        clearTimeout(embedTimer);
        setActive(true);
        notifyParent(true, 'clip');
      };
      embedFailedRef.current = () => { if (epoch === playbackEpoch && !stopped) showGif(fallback); };
      clearTimeout(embedTimer);
      embedTimer = setTimeout(() => embedFailedRef.current(), 8_000);
      videoRef.current?.pause();
      setVideoPlaying(false);
      setEmbedUrl(url);
    };

    const playClip = async (clipUrl: string, thumbnailUrl: string, fallback?: { url: string; user: string }, vod?: { videoId?: string; vodOffset?: number; user?: string }) => {
      const epoch = ++playbackEpoch;
      lastGif = fallback;
      clearTimeout(embedTimer);
      setEmbedUrl('');
      setVideoPlaying(false);
      setGifUrl('');
      // Twitch's interactive player can switch to the source VOD without
      // replacing the iframe that owns the broadcaster's click.
      if (/^\d+$/.test(String(vod?.videoId || '')) && Number.isFinite(Number(vod?.vodOffset)) && Number(vod?.vodOffset) >= 0) {
        videoRef.current?.pause();
        setClipUser(vod?.user || fallback?.user || '');
        setSpotlight(true);
        setActive(true);
        notifyParent(true, 'vod', { videoId: vod!.videoId!, vodOffset: vod!.vodOffset! });
        return;
      }
      setSpotlight(false);
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
          videoRef.current.muted = false;
          if (spotlightLevelRef.current !== null) videoRef.current.volume = spotlightLevelRef.current;
          videoRef.current.load();
          videoRef.current.play().then(() => {
            if (epoch !== playbackEpoch || stopped) return;
            setSpotlight(false);
            setGifUrl('');
            setActive(true);
            setVideoPlaying(true);
            notifyParent(true, 'clip');
          }).catch((err: unknown) => { console.warn('[BRB] Clip playback failed:', err); if (epoch === playbackEpoch) playEmbed(clipId, epoch, fallback); });
        }
      } catch (err) {
        console.error('[BRB] Clip load failed:', err);
        if (epoch === playbackEpoch) playEmbed(clipId, epoch, fallback);
      }
    };

    const notifyParent = (on: boolean, mode: 'clip' | 'gif' | 'vod' | 'stream' = 'clip', vod?: { videoId: string; vodOffset: number }) => {
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'spmt-lounge-brb-audio', active: on, mode, ...vod }, 'https://spmt.live');
      }
    };

    // The Lounge forwards health from its persistent worker viewer. When the
    // live picture is unavailable, cover it with the existing community clips.
    // Manual BRB always takes priority over this automatic intermission.
    const stopAutomatic = () => {
      clearTimeout(autoStartTimer);
      autoStartTimer = undefined;
      clearTimeout(autoStopTimer);
      clearTimeout(autoClipTimer);
      if (!automatic) return;
      automatic = false;
      autoEpoch++;
      playbackEpoch++;
      clearTimeout(embedTimer);
      videoRef.current?.pause();
      setEmbedUrl('');
      setVideoPlaying(false);
      setGifUrl('');
      setSpotlight(false);
      setClipUser('');
      setActive(false);
      notifyParent(false);
    };

    const startAutomatic = async () => {
      if (stopped || manual || automatic || spotlightHealthy) return;
      automatic = true;
      const epoch = ++autoEpoch;
      setActive(true);
      notifyParent(true, 'gif');

      let sponsorLoopStarted = false;
      let readyGifBuffer: SponsorGif[] = [];
      let gifPool: SponsorGif[] = [];
      let refillPromise: Promise<void> | null = null;
      const usedGifUrls = new Set<string>();

      const stillAutomatic = () => automatic && !stopped && epoch === autoEpoch && !manual;

      const shuffle = <T,>(items: T[]): T[] => {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      };

      const preloadSponsorGif = (gif: SponsorGif): Promise<SponsorGif | null> => new Promise((resolve) => {
        const image = new Image();
        const timeout = setTimeout(() => {
          image.onload = null;
          image.onerror = null;
          resolve(null);
        }, 8_000);
        image.onload = () => {
          clearTimeout(timeout);
          image.onload = null;
          image.onerror = null;
          resolve(gif);
        };
        image.onerror = () => {
          clearTimeout(timeout);
          image.onload = null;
          image.onerror = null;
          resolve(null);
        };
        image.src = gif.url;
      });

      const fetchGifPool = async () => {
        const response = await fetch('https://discord-stream-hub-new.fly.dev/api/lounge/brb-gifs', {
          cache: 'no-store', signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`DSH sponsor GIF bank unavailable: ${response.status}`);
        const data = await response.json();
        const candidates: SponsorGif[] = Array.isArray(data.gifs) ? data.gifs
          .filter((gif: { url?: string }) => typeof gif.url === 'string'
            && gif.url.startsWith('https://discord-stream-hub-new.fly.dev/api/media/'))
          .map((gif: { url: string; user?: string }) => ({ url: gif.url, user: String(gif.user || '') })) : [];
        const queued = new Set(readyGifBuffer.map((gif) => gif.url));
        let fresh = candidates.filter((gif) => !usedGifUrls.has(gif.url) && !queued.has(gif.url));
        if (!fresh.length && candidates.length) {
          usedGifUrls.clear();
          fresh = candidates.filter((gif) => !queued.has(gif.url));
        }
        gifPool = shuffle(fresh);
      };

      const refillReadyGifBuffer = async () => {
        if (!stillAutomatic() || readyGifBuffer.length >= SPONSOR_GIF_BUFFER_SIZE) return;
        if (refillPromise) return refillPromise;
        refillPromise = (async () => {
          try {
            if (gifPool.length < SPONSOR_GIF_BUFFER_SIZE - readyGifBuffer.length) await fetchGifPool();
            if (!stillAutomatic()) return;
            const need = Math.max(0, SPONSOR_GIF_BUFFER_SIZE - readyGifBuffer.length);
            const selected: SponsorGif[] = [];
            while (selected.length < need && gifPool.length) {
              const gif = gifPool.shift()!;
              if (usedGifUrls.has(gif.url) || readyGifBuffer.some((queued) => queued.url === gif.url)) continue;
              usedGifUrls.add(gif.url);
              selected.push(gif);
            }
            const preloaded = (await Promise.all(selected.map(preloadSponsorGif)))
              .filter((gif): gif is SponsorGif => Boolean(gif));
            if (stillAutomatic()) readyGifBuffer.push(...preloaded);
          } catch (error) {
            if (stillAutomatic()) console.warn('[BRB] Sponsor GIF buffer refill failed:', error);
          }
        })().finally(() => { refillPromise = null; });
        return refillPromise;
      };

      const nextSponsorGif = () => {
        if (!stillAutomatic()) return;
        if (readyGifBuffer.length <= 5) void refillReadyGifBuffer();
        const gif = readyGifBuffer.shift();
        if (gif) {
          showGif(gif);
          autoClipTimer = setTimeout(nextSponsorGif, SPONSOR_GIF_DURATION_MS);
          return;
        }
        void refillReadyGifBuffer();
        autoClipTimer = setTimeout(nextSponsorGif, 500);
      };

      const ensureSponsorLoop = () => {
        if (!stillAutomatic() || sponsorLoopStarted || !readyGifBuffer.length) return;
        sponsorLoopStarted = true;
        nextSponsorGif();
      };

      // Load ~3 minutes of already-stored GIFs first. Automatic Spotlight cover
      // never opens Twitch clips, so prerolls cannot recurse into another stall.
      void refillReadyGifBuffer().then(() => ensureSponsorLoop());
    };

    const onSpotlightHealth = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== 'https://spmt.live'
        || event.data?.type !== 'spmt-lounge-spotlight-health'
        || typeof event.data.healthy !== 'boolean') return;
      spotlightHealthy = event.data.healthy;
      if (spotlightHealthy) {
        clearTimeout(autoStartTimer);
        autoStartTimer = undefined;
        clearTimeout(autoStopTimer);
        autoStopTimer = setTimeout(() => { if (spotlightHealthy) stopAutomatic(); }, 3000);
      } else {
        clearTimeout(autoStopTimer);
        if (!automatic && !manual) {
          if (!autoStartTimer) autoStartTimer = setTimeout(() => {
            autoStartTimer = undefined;
            void startAutomatic();
          }, 6000);
        }
      }
    };
    window.addEventListener('message', onSpotlightHealth);

    const stopTest = () => {
      testGeneration++;
      clearTimeout(testTimer);
      setTestStream(false);
    };

    const onVideoError = () => { if ((manual || automatic) && lastGif) showGif(lastGif); };
    videoRef.current?.addEventListener('error', onVideoError);

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        ws.onclose = () => { if (stopped) return; if (manual) { setActive(false); notifyParent(false); } reconnect = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'testbrb-start') {
              const users = Array.isArray(msg.payload?.users)
                ? msg.payload.users.filter((user: unknown): user is string => typeof user === 'string' && /^[a-z0-9_]{3,25}$/.test(user)).slice(0, 24)
                : [];
              if (!users.length) return;
              stopAutomatic();
              stopTest();
              manual = true;
              playbackEpoch++;
              clearTimeout(embedTimer);
              videoRef.current?.pause();
              setEmbedUrl('');
              setVideoPlaying(false);
              setGifUrl('');
              setSpotlight(true);
              setTestStream(true);
              setActive(true);
              notifyParent(true, 'stream');
              const generation = testGeneration;
              const duration = Math.max(10_000, Math.min(120_000, Number(msg.payload.duration) || 30_000));
              let index = 0;
              const next = () => {
                if (stopped || generation !== testGeneration) return;
                const channel = users[index++ % users.length];
                setClipUser(channel);
                // Switch channels inside the already mounted Spotlight Twitch player.
                window.parent.postMessage({ type: 'spmt-lounge-testbrb', channel }, 'https://spmt.live');
                testTimer = setTimeout(next, duration);
              };
              next();
              return;
            }
            if (msg.type === 'brb-start') {
              stopTest();
              manual = true;
              playbackEpoch++;
              clearTimeout(embedTimer);
              videoRef.current?.pause();
              setEmbedUrl('');
              setVideoPlaying(false);
              setGifUrl('');
              setClipUser('');
              setActive(true);
              setSpotlight(false);
              notifyParent(true, 'gif');
            }
            if (msg.type === 'brb-clip' && msg.payload) {
              stopAutomatic();
              stopTest();
              manual = true;
              setClipUser(msg.payload.user || '');
              notifyParent(true, 'clip');
              playClip(msg.payload.clipUrl, msg.payload.thumbnailUrl, msg.payload.gifUrl ? { url: msg.payload.gifUrl, user: msg.payload.user } : undefined, msg.payload);
            }
            if (msg.type === 'brb-gif' && msg.payload) {
              stopAutomatic();
              stopTest();
              manual = true;
              playbackEpoch++;
              showGif(msg.payload);
            }
            if (msg.type === 'brb-no-media' || msg.type === 'brb-stop') {
              stopTest();
              if (msg.type === 'brb-stop') manual = false;
              if (!manual && !spotlightHealthy && !autoStartTimer) autoStartTimer = setTimeout(() => {
                autoStartTimer = undefined;
                void startAutomatic();
              }, 6000);
              playbackEpoch++;
              clearTimeout(embedTimer);
              setEmbedUrl('');
              setVideoPlaying(false);
              setGifUrl('');
              setClipUser('');
              setActive(msg.type === 'brb-no-media');
              setSpotlight(false);
              notifyParent(msg.type === 'brb-no-media', 'gif');
              if (videoRef.current) videoRef.current.src = '';
            }
          } catch {}
        };
      } catch {
        reconnect = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { stopped = true; clearTimeout(reconnect); clearTimeout(embedTimer); clearTimeout(testTimer); clearTimeout(autoStartTimer); clearTimeout(autoStopTimer); clearTimeout(autoClipTimer); window.removeEventListener('message', onSpotlightHealth); ws?.close(); videoRef.current?.removeEventListener('error', onVideoError); notifyParent(false); };
  }, []);

  return (
    <div style={{
      width: '100vw', height: '100vh', background: (active || embedUrl) && !spotlight ? '#071127' : 'transparent',
      overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative'
    }}>
      <video
        ref={videoRef}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: videoPlaying && !spotlight && !gifUrl && !embedUrl ? 'block' : 'none' }}
        autoPlay
      />
      {embedUrl && <iframe key={`${embedUrl}:${spotlightLevel === 0}`} src={embedUrl.replace('muted=false', `muted=${spotlightLevel === 0}`)} title="Twitch BRB clip" allow="autoplay; fullscreen" onLoad={() => embedLoadedRef.current()} onError={() => embedFailedRef.current()} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />}
      {active && gifUrl && <img onError={() => { setGifUrl(''); setClipUser(''); }} src={gifUrl} alt={clipUser ? `${clipUser}'s community GIF` : 'Community GIF'} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />}
      {active && <div style={{ position: 'absolute', left: '50%', top: 12, transform: 'translateX(-50%)', zIndex: 4, padding: '7px 20px', borderRadius: '999px', background: '#071127', border: '1px solid #54dffa', boxShadow: '0 0 15px rgba(58, 197, 248, .45)', color: '#eefaff', font: '800 clamp(14px, 2.6vw, 24px) system-ui, sans-serif', letterSpacing: '.15em', textAlign: 'center', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{testStream ? 'TEST BRB' : 'AND NOW A WORD FROM OUR SPONSORS'}</div>}
      {active && !embedUrl && !gifUrl && !videoPlaying && <div style={{ position: 'absolute', zIndex: 2, color: '#c4eefe', font: '600 18px system-ui, sans-serif', textAlign: 'center', pointerEvents: 'none' }}>Community clips are coming up</div>}
      {active && spotlight && (
        <div style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 5, padding: '8px 14px', borderRadius: 9,
          background: 'rgba(5,12,30,.83)', border: '1px solid rgba(103,232,249,.65)',
          color: '#e8fbff', font: '700 16px system-ui, sans-serif', pointerEvents: 'none' }}>
          {clipUser ? `📹 @${clipUser}` : 'BRB - Community Spotlight'}
        </div>
      )}
      {active && !spotlight && clipUser && (
        <div style={{
          position: 'absolute', bottom: 20, right: 20, zIndex: 5, maxWidth: 'calc(100% - 40px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none',
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
