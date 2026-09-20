'use client';

import * as React from 'react';
import { AutoFitText } from '@/components/overlay/auto-fit-text';

type Creator = {
  username: string;
  displayName: string;
  avatarUrl: string;
  gameName: string;
  viewerCount: number;
};

export default function LoungeLiveShoutouts() {
  const [group, setGroup] = React.useState<'partner' | 'community'>('community');
  const [creators, setCreators] = React.useState<Creator[]>([]);
  const [index, setIndex] = React.useState(0);
  const [leaving, setLeaving] = React.useState(false);

  React.useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get('group');
    setGroup(selected === 'partner' ? 'partner' : 'community');
  }, []);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/lounge/live-shoutouts?group=${group}`, { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json();
        if (!active) return;
        setCreators(Array.isArray(body?.creators) ? body.creators : []);
        setIndex((current) => Math.min(current, Math.max(0, (body?.creators?.length || 1) - 1)));
      } catch {}
    };
    void load();
    const refresh = window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(refresh); };
  }, [group]);

  React.useEffect(() => {
    if (creators.length < 2) return;
    let transitionTimer: number | undefined;
    const rotation = window.setInterval(
      () => {
        setLeaving(true);
        transitionTimer = window.setTimeout(() => {
          setIndex((current) => (current + 1) % creators.length);
          setLeaving(false);
        }, 1_100);
      },
      group === 'partner' ? 36_000 : 18_000,
    );
    return () => {
      window.clearInterval(rotation);
      if (transitionTimer) window.clearTimeout(transitionTimer);
    };
  }, [creators.length, group]);

  const creator = creators[index] || null;
  const initial = creator?.displayName.trim().charAt(0).toUpperCase() || '✦';

  return (
    <main className="stage">
      <style jsx global>{`html, body { background: transparent !important; overflow: hidden !important; } * { box-sizing: border-box; }`}</style>
      <style jsx>{`
        .stage { position: fixed; inset: 0; padding: 3px; overflow: hidden; color: #fff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        .card { position: relative; display: grid; width: 100%; height: 100%; grid-template-columns: 64px minmax(0,1fr); align-items: center; gap: 9px; overflow: hidden; padding: 8px 10px; border: 2px solid #25e9ff; border-radius: 11px; background: radial-gradient(circle at 92% 5%, rgba(83,233,255,.25), transparent 38%), linear-gradient(135deg, rgba(72,35,142,.97), rgba(9,89,157,.97)); box-shadow: inset 0 0 16px rgba(68,225,255,.25), 0 0 10px rgba(37,233,255,.72); }
        .card::before { content: ''; position: absolute; inset: 0; opacity: .23; background-image: radial-gradient(circle, #fff 0 1px, transparent 1.4px); background-size: 27px 27px; pointer-events: none; }
        .avatar, .avatarFallback { position: relative; z-index: 1; width: 62px; height: 62px; border: 2px solid #78f2ff; border-radius: 50%; box-shadow: 0 0 10px rgba(37,233,255,.7); }
        .avatar { object-fit: cover; }
        .avatarFallback { display: grid; place-items: center; background: linear-gradient(145deg,#7143c9,#168fc8); font: 900 30px Georgia,serif; }
        .copy { position: relative; z-index: 1; min-width: 0; padding-top: 22px; }
        .card:not(.leaving) .copy, .card:not(.leaving) .avatar, .card:not(.leaving) .avatarFallback, .card:not(.leaving) .live { animation: slideIn 1.1s cubic-bezier(.2,.8,.2,1) both; }
        .card.leaving .copy, .card.leaving .avatar, .card.leaving .avatarFallback, .card.leaving .live { animation: slideOut 1.1s cubic-bezier(.4,0,.8,.2) both; }
        .name { overflow: hidden; font: 900 clamp(16px,8vw,25px)/1 Georgia,'Times New Roman',serif; text-overflow: ellipsis; text-shadow: 0 2px 4px #000; white-space: nowrap; }
        .game { margin-top: 4px; overflow: hidden; color: #e8f9ff; font-size: 11px; font-weight: 800; line-height: 1.05; text-overflow: ellipsis; white-space: nowrap; }
        .live { position: absolute; z-index: 2; right: 8px; top: 7px; display: flex; min-width: 48px; flex-direction: row; align-items: center; justify-content: center; gap: 4px; padding: 4px 6px; border-radius: 8px; background: rgba(2,8,30,.82); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
        .live strong { color: #ff6683; font-size: 10px; letter-spacing: .08em; }
        .live span { color: #ffe76f; font-size: 12px; font-weight: 1000; }
        .empty { grid-template-columns: 1fr; justify-items: center; text-align: center; }
        .empty strong { position: relative; z-index: 1; color: #bdf7ff; font-size: 13px; letter-spacing: .08em; }
        @keyframes slideIn { from { opacity: 0; transform: translateY(32px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-32px); } }
      `}</style>
      {creator ? (
        <article className={`card${leaving ? ' leaving' : ''}`} key={`${creator.username}-${index}`}>
          {creator.avatarUrl ? <img className="avatar" src={creator.avatarUrl} alt="" /> : <div className="avatarFallback">{initial}</div>}
          <div className="copy">
            <AutoFitText className="name" minFontSize={12} maxFontSize={25}>{creator.displayName}</AutoFitText>
            <AutoFitText className="game" minFontSize={8} maxFontSize={13}>{creator.gameName || 'Just Chatting'}</AutoFitText>
          </div>
          <div className="live"><strong>● LIVE</strong><span>{creator.viewerCount.toLocaleString()}</span></div>
        </article>
      ) : (
        <article className="card empty"><strong>{group === 'partner' ? 'SCANNING PARTNERS & CREW' : 'SCANNING THE COMMUNITY'}</strong></article>
      )}
    </main>
  );
}
