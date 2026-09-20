'use client';

import * as React from 'react';

type StatusPayload = {
  games: Array<{ id: string; name: string; command: string }>;
  spotlight: null | { login: string; displayName: string; avatarUrl: string };
};

export default function LoungeStatusStrip() {
  const [payload, setPayload] = React.useState<StatusPayload>({ games: [], spotlight: null });
  const [rotationIndex, setRotationIndex] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/lounge/status-strip', { cache: 'no-store' });
        if (!response.ok) return;
        const next = await response.json();
        if (active) setPayload({ games: Array.isArray(next?.games) ? next.games : [], spotlight: next?.spotlight || null });
      } catch {}
    };
    void load();
    const refresh = window.setInterval(() => void load(), 15_000);
    return () => { active = false; window.clearInterval(refresh); };
  }, []);

  const rotationCount = payload.games.length + (payload.spotlight ? 1 : 0);

  React.useEffect(() => {
    setRotationIndex((current) => rotationCount ? current % rotationCount : 0);
    if (rotationCount < 2) return;
    const rotation = window.setInterval(() => setRotationIndex((current) => (current + 1) % rotationCount), 8_000);
    return () => window.clearInterval(rotation);
  }, [rotationCount]);

  const spotlight = payload.spotlight;
  const activeIndex = rotationIndex % Math.max(1, rotationCount);
  const showSpotlight = Boolean(spotlight) && activeIndex === payload.games.length;
  const game = showSpotlight ? null : payload.games[activeIndex] || null;
  const initial = spotlight?.displayName.charAt(0).toUpperCase() || '✦';

  return (
    <main className="stage">
      <style jsx global>{`html, body { background: transparent !important; overflow: hidden !important; } * { box-sizing: border-box; }`}</style>
      <style jsx>{`
        .stage { position: fixed; inset: 0; padding: 2px; color: #fff; font-family: Inter,ui-sans-serif,system-ui,sans-serif; }
        .strip { display: flex; width: 100%; height: 100%; align-items: center; gap: 7px; overflow: hidden; padding: 3px 8px; border: 1.5px solid #25e9ff; border-radius: 9px; background: linear-gradient(100deg,rgba(75,31,142,.96),rgba(8,91,157,.96)); box-shadow: inset 0 0 11px rgba(68,225,255,.24),0 0 8px rgba(37,233,255,.65); animation: swap .42s ease-out both; }
        .avatar,.fallback { width: 29px; height: 29px; flex: 0 0 auto; border: 1.5px solid #8df5ff; border-radius: 50%; }
        .avatar { object-fit: cover; } .fallback { display:grid;place-items:center;background:#6240a7;font-weight:1000; }
        .copy { min-width: 0; flex: 1; }
        .label { color:#9ff5ff;font-size:7px;font-weight:1000;letter-spacing:.12em;line-height:1; }
        .value { margin-top:3px;overflow:hidden;font:900 13px/1 Georgia,'Times New Roman',serif;text-overflow:ellipsis;text-shadow:0 1px 3px #000;white-space:nowrap; }
        .gameIcon { flex:0 0 auto;font-size:21px;filter:drop-shadow(0 0 5px #6fefff); }
        @keyframes swap { from { opacity:0;transform:translateY(10px); } to { opacity:1;transform:translateY(0); } }
      `}</style>
      {game && !showSpotlight ? (
        <section className="strip" key={game.id}><div className="gameIcon">🎮</div><div className="copy"><div className="label">ACTIVE GAME</div><div className="value">{game.name}{game.command ? ` · !${game.command}` : ''}</div></div></section>
      ) : (
        <section className="strip" key={spotlight?.login || 'waiting'}>
          {spotlight?.avatarUrl ? <img className="avatar" src={spotlight.avatarUrl} alt="" /> : <div className="fallback">{initial}</div>}
          <div className="copy"><div className="label">NOW SHOWING</div><div className="value">{spotlight ? `@${spotlight.login}` : 'No live spotlight'}</div></div>
        </section>
      )}
    </main>
  );
}
