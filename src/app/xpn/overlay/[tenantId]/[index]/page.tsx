'use client';

import { useParams } from 'next/navigation';

const OVERLAY_PATHS: string[] = [
  '/tts-player',
  '/shoutout-player',
  '/brb-player',
  '/pokemon-pack-overlay',
  '/pokemon-collection-overlay',
  '/pokemon-trade-overlay',
  '/gym-battle-overlay',
  '/classic-gamble-overlay',
  '/gamble-overlay',
  '/partner-checkin',
];

export default function XpnOverlayPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const index = parseInt(params.index as string, 10);

  const overlayPath = OVERLAY_PATHS[index - 1];

  if (!overlayPath || !tenantId) {
    return (
      <div style={{ color: 'white', fontFamily: 'sans-serif', padding: 20 }}>
        Invalid XPN overlay URL
      </div>
    );
  }

  const src = `${overlayPath}?tenant=${encodeURIComponent(tenantId)}`;

  return (
    <iframe
      src={src}
      style={{
        width: '100%',
        height: '100vh',
        border: 'none',
        overflow: 'hidden',
      }}
      allow="autoplay"
    />
  );
}

