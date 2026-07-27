'use client';

import { useEffect, useRef } from 'react';

const ALLOWED_PARENT_ORIGINS = new Set([
  'https://spacemountain.live',
  'https://spacemountain-live.fly.dev',
]);

type SpaceMountainAuthMessage = {
  type?: string;
  source?: string;
  launchCode?: string | null;
  targetOrigin?: string;
};

export function SpaceMountainEmbedBridge() {
  const exchangeInFlight = useRef(false);

  useEffect(() => {
    if (window.self === window.top) return;

    const parentOrigin = (() => {
      try {
        return new URL(document.referrer).origin;
      } catch {
        return '';
      }
    })();
    if (!ALLOWED_PARENT_ORIGINS.has(parentOrigin)) return;

    async function handleMessage(event: MessageEvent<SpaceMountainAuthMessage>) {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.type !== 'SPACEMOUNTAIN_AUTH' || event.data?.source !== 'spacemountain.live') return;
      if (!event.data.launchCode || exchangeInFlight.current) return;

      exchangeInFlight.current = true;
      try {
        const session = await fetch('/api/session', { credentials: 'include', cache: 'no-store' });
        if (session.ok) {
          window.parent.postMessage({ type: 'SPACEMOUNTAIN_AUTH_READY', source: 'streamweaver' }, parentOrigin);
          return;
        }

        const response = await fetch('/api/auth/embed/exchange', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: event.data.launchCode, parentOrigin }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `Embed sign-in failed (${response.status})`);
        }
        window.parent.postMessage({ type: 'SPACEMOUNTAIN_AUTH_READY', source: 'streamweaver' }, parentOrigin);
        window.location.reload();
      } catch (error) {
        console.error('[SpaceMountain Embed] Sign-in bridge failed', error);
        window.parent.postMessage({
          type: 'SPACEMOUNTAIN_AUTH_ERROR',
          source: 'streamweaver',
          message: error instanceof Error ? error.message : 'Embed sign-in failed',
        }, parentOrigin);
      } finally {
        exchangeInFlight.current = false;
      }
    }

    window.addEventListener('message', handleMessage);
    window.parent.postMessage({ type: 'SPACEMOUNTAIN_AUTH_REQUEST', source: 'streamweaver' }, parentOrigin);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return null;
}
