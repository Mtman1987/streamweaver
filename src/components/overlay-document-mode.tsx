'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const OVERLAY_PREFIXES = [
  '/overlay/',
  '/xpn/overlay/',
  '/tts/',
];

const OVERLAY_PATHS = new Set([
  '/brb-player',
  '/classic-gamble-overlay',
  '/gamble-overlay',
  '/gym-battle-overlay',
  '/partner-checkin',
  '/pokemon-overlay',
  '/pokemon-collection-overlay',
  '/pokemon-pack-overlay',
  '/pokemon-trade-overlay',
  '/shoutout-player',
  '/tts-listener',
  '/tts-player',
]);

function isOverlayPath(pathname: string): boolean {
  return OVERLAY_PATHS.has(pathname) || OVERLAY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function OverlayDocumentMode() {
  const pathname = usePathname() || '';

  useEffect(() => {
    const enabled = isOverlayPath(pathname);
    document.documentElement.classList.toggle('overlay-document', enabled);
    document.body.classList.toggle('overlay-document', enabled);

    return () => {
      document.documentElement.classList.remove('overlay-document');
      document.body.classList.remove('overlay-document');
    };
  }, [pathname]);

  return null;
}
