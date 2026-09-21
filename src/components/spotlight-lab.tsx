'use client';

import * as React from 'react';

type Method = 'official-api' | 'reload-iframe' | 'multitwitch';
type Creator = { username: string; displayName?: string };

declare global {
  interface Window {
    Twitch?: any;
  }
}

const METHOD_COPY: Record<Method, { title: string; summary: string }> = {
  'official-api': {
    title: 'Official Twitch Player API',
    summary: 'One player stays mounted. The rotation calls Twitch setChannel() every 30 seconds instead of replacing the page.',
  },
  'reload-iframe': {
    title: 'Official Twitch URL Reload',
    summary: 'The browser source reloads a fresh official Twitch iframe URL for every channel. This is closest to the current spotlight behavior.',
  },
  multitwitch: {
    title: 'MultiTwitch URL Reload',
    summary: 'The browser source loads MultiTwitch with one channel in its URL, then replaces that URL every 30 seconds.',
  },
};

function cleanCreators(value: unknown): Creator[] {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return rows.flatMap((row: any) => {
    const username = String(row?.username || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(username) || seen.has(username)) return [];
    seen.add(username);
    return [{ username, displayName: String(row?.displayName || username).trim() || username }];
  });
}

export function SpotlightLab({ method }: { method: Method }) {
  const [creators, setCreators] = React.useState<Creator[]>([]);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [started, setStarted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState('Click Start test to load the live creator rotation.');
  const [volume, setVolume] = React.useState(0.45);
  const playerHostRef = React.useRef<HTMLDivElement>(null);
  const playerRef = React.useRef<any>(null);
  const scriptPromiseRef = React.useRef<Promise<void> | null>(null);

  const active = creators[activeIndex] || null;
  const parent = typeof window === 'undefined' ? 'spacemountain.live' : window.location.hostname;

  const fetchLiveCreators = React.useCallback(async () => {
    const groups = await Promise.all(['community', 'partner'].map(async (group) => {
      const response = await fetch(`/api/lounge/live-shoutouts?group=${group}`, { cache: 'no-store' });
      const payload = response.ok ? await response.json() : {};
      return cleanCreators(payload?.creators);
    }));
    const merged = cleanCreators(groups.flat());
    setCreators(merged);
    setActiveIndex((current) => Math.min(current, Math.max(0, merged.length - 1)));
    return merged;
  }, []);

  const ensureTwitchScript = React.useCallback(() => {
    if (window.Twitch?.Player) return Promise.resolve();
    if (scriptPromiseRef.current) return scriptPromiseRef.current;
    scriptPromiseRef.current = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://player.twitch.tv/js/embed/v1.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Twitch player script did not load.'));
      document.head.appendChild(script);
    });
    return scriptPromiseRef.current;
  }, []);

  const start = async () => {
    setLoading(true);
    try {
      const live = await fetchLiveCreators();
      if (!live.length) {
        setMessage('No approved community or partner stream is live right now. Try again once someone is live.');
        return;
      }
      setStarted(true);
      setMessage(method === 'official-api'
        ? 'Started. The same Twitch player will receive the next channel in 30 seconds.'
        : 'Started. This method will fully load the next URL in 30 seconds.');
    } catch {
      setMessage('The live creator feed could not be reached. Try Start test again.');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (!started || creators.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % creators.length);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [started, creators.length]);

  React.useEffect(() => {
    if (!started) return;
    const timer = window.setInterval(() => { void fetchLiveCreators(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [started, fetchLiveCreators]);

  React.useEffect(() => {
    if (method !== 'official-api' || !started || !active || !playerHostRef.current) return;
    let disposed = false;
    const mount = async () => {
      try {
        await ensureTwitchScript();
        if (disposed || !playerHostRef.current) return;
        if (!playerRef.current) {
          playerHostRef.current.replaceChildren();
          const hostId = 'spotlight-lab-player';
          const host = document.createElement('div');
          host.id = hostId;
          playerHostRef.current.appendChild(host);
          const player = new window.Twitch.Player(hostId, {
            channel: active.username,
            width: '100%', height: '100%',
            parent: [parent], autoplay: true, muted: false,
          });
          playerRef.current = player;
          player.addEventListener(window.Twitch.Player.READY, () => {
            player.setVolume(volume);
            player.play();
          });
          player.addEventListener(window.Twitch.Player.PLAYBACK_BLOCKED, () => {
            setMessage('Twitch blocked unmuted autoplay. Click inside the video once, then the API rotation can continue.');
          });
        } else {
          playerRef.current.setChannel(active.username);
          playerRef.current.setVolume(volume);
          playerRef.current.play();
        }
      } catch {
        setMessage('Could not load the Twitch Player API. Refresh this page and try again.');
      }
    };
    void mount();
    return () => { disposed = true; };
  }, [active?.username, ensureTwitchScript, method, parent, started, volume]);

  React.useEffect(() => () => { playerRef.current = null; }, []);

  const playerUrl = active ? `https://player.twitch.tv/?channel=${encodeURIComponent(active.username)}&parent=${encodeURIComponent(parent)}&autoplay=true&muted=false` : '';
  const multiTwitchUrl = active ? `https://multitwitch.tv/${encodeURIComponent(active.username)}` : '';
  const copy = METHOD_COPY[method];

  return (
    <main className="lab">
      <style jsx>{`
        .lab { min-height: 100vh; padding: 24px; color: #eefaff; font-family: var(--font-inter), Arial, sans-serif; background: radial-gradient(circle at top left, #1c4388, transparent 42%), #060a1c; }
        .shell { max-width: 1180px; margin: 0 auto; }
        h1 { margin: 0; font: 800 clamp(27px,4vw,46px)/1 var(--font-space-grotesk), sans-serif; letter-spacing: -.04em; }
        .kicker { margin: 0 0 8px; color: #7eefff; font-weight: 800; letter-spacing: .12em; font-size: 12px; }
        .summary { max-width: 780px; color: #b9c9ed; line-height: 1.55; }
        .control { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 22px 0 16px; padding: 14px; border: 1px solid rgba(91,232,255,.45); border-radius: 16px; background: rgba(10,18,52,.78); }
        button { cursor: pointer; border: 0; border-radius: 10px; padding: 11px 16px; color: #031326; background: linear-gradient(135deg,#76f3ff,#75a9ff); font-weight: 900; }
        button:disabled { cursor: wait; opacity: .6; }
        .status { flex: 1 1 280px; color: #dbe6ff; font-size: 14px; }
        .volume { display: flex; gap: 8px; align-items: center; color: #dbe6ff; font-size: 13px; font-weight: 700; }
        input { accent-color: #6defff; }
        .stage { position: relative; overflow: hidden; aspect-ratio: 16 / 9; border: 2px solid #41dfee; border-radius: 18px; background: #010207; box-shadow: 0 0 45px rgba(57,216,255,.22); }
        .player, .player :global(iframe), .frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
        .waiting { display: grid; place-items: center; height: 100%; color: #a9b9d7; text-align: center; padding: 20px; }
        .now { display: flex; justify-content: space-between; gap: 10px; margin: 14px 3px; color: #e4efff; font-weight: 800; }
        .now span { color: #76f3ff; }
        .foot { color: #93a6cb; font-size: 13px; line-height: 1.5; }
        a { color: #78efff; }
      `}</style>
      <section className="shell">
        <p className="kicker">SPACE MOUNTAIN • SPOTLIGHT LAB</p>
        <h1>{copy.title}</h1>
        <p className="summary">{copy.summary} It uses the same live community and partner feed as your existing spotlight, and rotates every 30 seconds.</p>
        <div className="control">
          <button type="button" onClick={() => void start()} disabled={loading}>{loading ? 'Loading live creators…' : started ? 'Restart test' : 'Start test'}</button>
          <label className="volume">Volume <input aria-label="Twitch player volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
          <span className="status">{message}</span>
        </div>
        <div className="stage">
          {!started || !active ? <div className="waiting">{started ? 'Waiting for a live approved creator…' : 'The player will appear here after you start the test.'}</div> : method === 'official-api' ? (
            <div className="player" ref={playerHostRef} />
          ) : (
            <iframe className="frame" key={`${method}-${active.username}-${activeIndex}`} src={method === 'multitwitch' ? multiTwitchUrl : playerUrl} allow="autoplay; fullscreen" allowFullScreen title={`${copy.title}: ${active.username}`} />
          )}
        </div>
        <div className="now"><span>NOW TESTING</span><strong>{active ? `@${active.username} • next change in 30 seconds` : 'Waiting for live creators'}</strong></div>
        <p className="foot">For a fair comparison, click play once if Twitch asks. The important difference is what happens after the first 30-second change.</p>
      </section>
    </main>
  );
}
