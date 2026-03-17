'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

export default function BRBPlayer() {
  const searchParams = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const user = searchParams.get('user');
  const video = searchParams.get('video');
  const thumbnailUrl = searchParams.get('thumbnail_url');

  useEffect(() => {
    if (!video || !videoRef.current) return;

    const match = video.match(/clip=([^&]+)/);
    const clipId = match ? match[1] : null;
    if (!clipId) return;

    // Fetch MP4 URL from Twitch GraphQL
    const query = {
      operationName: "VideoAccessToken_Clip",
      variables: { platform: "web", slug: clipId },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: "6fd3af2b22989506269b9ac02dd87eb4a6688392d67d94e41a6886f1e9f5c00f"
        }
      }
    };

    fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko'
      },
      body: JSON.stringify(query)
    })
    .then(res => res.json())
    .then(data => {
      const clipSource = data.data.clip.videoQualities[0].sourceURL;
      const clipSig = data.data.clip.playbackAccessToken.signature;
      const clipToken = data.data.clip.playbackAccessToken.value;
      const videoSrc = `${clipSource}?sig=${clipSig}&token=${encodeURIComponent(clipToken)}`;
      
      if (videoRef.current) {
        videoRef.current.src = videoSrc;
        videoRef.current.load();
        videoRef.current.play();
      }
    })
    .catch(err => console.error('Failed to load clip:', err));
  }, [video]);

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      background: '#0e0e10',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative'
    }}>
      <video
        ref={videoRef}
        autoPlay
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain'
        }}
      />
      {user && (
        <div style={{
          position: 'absolute',
          bottom: '20px',
          left: '20px',
          background: 'rgba(0,0,0,0.8)',
          padding: '10px 20px',
          borderRadius: '8px',
          color: 'white',
          fontSize: '18px',
          fontFamily: 'Arial, sans-serif',
          zIndex: 10000
        }}>
          Clip by: {user}
        </div>
      )}
    </div>
  );
}
