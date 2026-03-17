'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function ShoutoutPlayer() {
  const searchParams = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const user = searchParams.get('user');
    const image = searchParams.get('image');
    const video = searchParams.get('video');
    const thumbnailUrl = searchParams.get('thumbnail_url');

    if (!video || !thumbnailUrl) {
      setError('Missing video or thumbnail URL');
      return;
    }

    const match = video.match(/clip=([^&]+)/);
    if (!match) {
      setError('Invalid video URL format');
      return;
    }

    const fullClipId = match[1];
    const match2 = fullClipId.match(/([^/]+)$/);
    const clipId = match2 ? match2[1] : fullClipId;

    const fetchClipUrl = async () => {
      try {
        const query = {
          operationName: 'VideoAccessToken_Clip',
          variables: {
            platform: 'web',
            slug: clipId
          },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: '6fd3af2b22989506269b9ac02dd87eb4a6688392d67d94e41a6886f1e9f5c00f'
            }
          }
        };

        const response = await fetch('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=UTF-8',
            'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko'
          },
          body: JSON.stringify(query)
        });

        if (!response.ok) {
          throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const clipInfo = await response.json();
        const clipData = clipInfo.data;
        
        if (!clipData?.clip?.videoQualities?.[0]?.sourceURL) {
          throw new Error('No video source found in response');
        }

        const clipSource = clipData.clip.videoQualities[0].sourceURL;
        const clipSig = clipData.clip.playbackAccessToken.signature;
        const clipToken = clipData.clip.playbackAccessToken.value;

        const videoSrc = `${clipSource}?sig=${clipSig}&token=${encodeURIComponent(clipToken)}`;

        if (videoRef.current) {
          videoRef.current.src = videoSrc;
          videoRef.current.load();
          
          setTimeout(() => {
            if (videoRef.current) {
              videoRef.current.style.visibility = 'visible';
              videoRef.current.play().catch(err => {
                console.error('Autoplay failed:', err);
                setError('Autoplay failed');
              });
            }
          }, 1000);
        }
      } catch (err) {
        console.error('Failed to fetch clip URL:', err);
        setError(err instanceof Error ? err.message : 'Failed to load clip');
      }
    };

    fetchClipUrl();
  }, [searchParams]);

  const handleEnded = () => {
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.src = '';
      }
      const imageBox = document.getElementById('imagebox2');
      if (imageBox) {
        imageBox.innerHTML = '';
      }
    }, 500);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden' }}>
      <div
        id="videocontainer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          zIndex: 10,
          textAlign: 'center'
        }}
      >
        <video
          ref={videoRef}
          id="videoplayer"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            visibility: 'hidden'
          }}
          autoPlay
          onEnded={handleEnded}
        />
      </div>

      <div
        id="imagebox2"
        style={{
          position: 'absolute',
          height: '66%',
          width: '37.5%',
          textAlign: 'center',
          zIndex: 1,
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)'
        }}
        dangerouslySetInnerHTML={{
          __html: searchParams.get('image')
            ? `<img src="${searchParams.get('image')}" width="100%" />`
            : ''
        }}
      />

      {error && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            background: 'rgba(255,0,0,0.8)',
            color: 'white',
            padding: '10px',
            borderRadius: '5px',
            zIndex: 100
          }}
        >
          Error: {error}
        </div>
      )}
    </div>
  );
}
