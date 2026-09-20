'use client';

import * as React from 'react';
import {
  buildLoungeCommandMarquee,
  loungeMarqueeMoment,
  LOUNGE_THANKS_MESSAGE,
  type LoungeMarqueeGame,
} from '@/lib/lounge-marquee';

type StatusPayload = { games: LoungeMarqueeGame[] };

function requestedPreviewMode(): 'commands' | 'thanks' | 'compact' | null {
  const value = new URLSearchParams(window.location.search).get('footerPreview');
  return value === 'commands' || value === 'thanks' || value === 'compact' ? value : null;
}

export function LoungeAttributionMarquee() {
  const [games, setGames] = React.useState<LoungeMarqueeGame[]>([]);
  const [now, setNow] = React.useState<number | null>(null);
  const [preview, setPreview] = React.useState<'commands' | 'thanks' | 'compact' | null>(null);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/lounge/status-strip', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json() as StatusPayload;
        if (active) setGames(Array.isArray(payload?.games) ? payload.games : []);
      } catch {}
    };
    void load();
    const refresh = window.setInterval(() => void load(), 15_000);
    return () => { active = false; window.clearInterval(refresh); };
  }, []);

  React.useEffect(() => {
    setPreview(requestedPreviewMode());
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  const scheduled = loungeMarqueeMoment(now || 0);
  const expanded = preview ? preview !== 'compact' : now !== null && scheduled.expanded;
  const mode = preview && preview !== 'compact' ? preview : scheduled.mode;
  const text = mode === 'commands' ? buildLoungeCommandMarquee(games) : LOUNGE_THANKS_MESSAGE;
  const durationSeconds = mode === 'commands'
    ? Math.max(64, Math.min(108, 34 + text.length * 0.07))
    : 62;

  return (
    <aside className={`lounge-credit ${expanded ? 'expanded' : 'compact'}`} aria-label="SpaceMountain Lounge credits and commands">
      <style jsx>{`
        .lounge-credit {
          --cyan: #29efff;
          --violet: #a970ff;
          position: absolute;
          z-index: 20;
          right: 10px;
          bottom: 8px;
          height: 50px;
          max-width: calc(100vw - 20px);
          overflow: hidden;
          border: 1.5px solid rgba(73, 237, 255, .92);
          border-radius: 15px;
          color: #fff;
          background:
            linear-gradient(110deg, rgba(12, 7, 35, .96), rgba(52, 20, 105, .95) 46%, rgba(3, 65, 112, .96));
          box-shadow: 0 0 11px rgba(41, 239, 255, .72), inset 0 0 18px rgba(128, 76, 255, .24);
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          pointer-events: none;
          transition: width .8s cubic-bezier(.2,.8,.2,1), border-radius .8s ease;
        }
        .compact { width: min(350px, calc(100vw - 20px)); }
        .expanded { width: calc(100vw - 20px); border-radius: 13px; }
        .brand {
          position: absolute;
          z-index: 2;
          inset: 0 auto 0 0;
          display: flex;
          width: 350px;
          max-width: 100%;
          align-items: center;
          gap: 9px;
          padding: 5px 12px 5px 7px;
          background: linear-gradient(90deg, rgba(9, 5, 28, .99) 0%, rgba(30, 13, 65, .98) 82%, rgba(30, 13, 65, 0) 100%);
          transition: width .6s ease;
        }
        .expanded .brand { width: 76px; padding-right: 21px; }
        .logo {
          width: 38px;
          height: 38px;
          flex: 0 0 auto;
          object-fit: contain;
          filter: drop-shadow(0 0 6px rgba(41,239,255,.72));
        }
        .credit-copy { min-width: 0; opacity: 1; transition: opacity .3s ease; }
        .expanded .credit-copy { opacity: 0; }
        .powered { color: #a8f8ff; font-size: 9px; font-weight: 950; letter-spacing: .14em; white-space: nowrap; }
        .builder { margin-top: 2px; font-family: Georgia, 'Times New Roman', serif; font-size: 17px; font-style: italic; font-weight: 800; line-height: 1; white-space: nowrap; text-shadow: 0 0 8px rgba(169,112,255,.8); }
        .marquee-window { position: absolute; inset: 0 0 0 62px; overflow: hidden; opacity: 0; transition: opacity .35s ease .35s; }
        .expanded .marquee-window { opacity: 1; }
        .track {
          position: absolute;
          left: 0;
          top: 0;
          display: flex;
          width: max-content;
          height: 100%;
          align-items: center;
          padding-left: calc(100vw - 70px);
          color: #fff;
          font-size: clamp(15px, 1.55vw, 24px);
          font-weight: 850;
          letter-spacing: .025em;
          white-space: nowrap;
          text-shadow: 0 2px 3px #000, 0 0 8px rgba(41,239,255,.42);
          animation-name: lounge-scroll;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }
        .mode { margin-right: 18px; color: #ffe678; font-family: Georgia, 'Times New Roman', serif; font-style: italic; letter-spacing: .08em; }
        @keyframes lounge-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }
        @media (max-width: 680px) {
          .lounge-credit { height: 46px; right: 7px; bottom: 6px; max-width: calc(100vw - 14px); }
          .compact { width: min(315px, calc(100vw - 14px)); }
          .expanded { width: calc(100vw - 14px); }
          .brand { width: 315px; }
          .logo { width: 34px; height: 34px; }
          .builder { font-size: 15px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .track { animation-duration: 1ms !important; transform: none !important; padding-left: 18px; }
        }
      `}</style>
      <div className="brand">
        <img className="logo" src="https://spmt.live/assets/space-logo-main.png" alt="" />
        <div className="credit-copy">
          <div className="powered">POWERED BY SPACEMOUNTAIN.LIVE</div>
          <div className="builder">Built by Mtman1987</div>
        </div>
      </div>
      {expanded && (
        <div className="marquee-window" key={`${scheduled.cycle}:${mode}:${text}`}>
          <div className="track" style={{ animationDuration: `${durationSeconds}s` }}>
            <span className="mode">{mode === 'commands' ? 'Available now' : 'With gratitude'}</span>
            <span>{text}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
