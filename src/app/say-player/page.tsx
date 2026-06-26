'use client';

import { useEffect, useRef, useState } from 'react';

export default function SayPlayer() {
  const playing = useRef(false);
  const [active, setActive] = useState(false);

  function start() {
    setActive(true);
  }

  useEffect(() => {
    if (!active) return;
    const poll = setInterval(async () => {
      if (playing.current) return;
      try {
        const res = await fetch('/api/say/next');
        const { text } = await res.json();
        if (!text) return;
        playing.current = true;
        const audio = new Audio(text);
        audio.onended = () => { playing.current = false; };
        audio.onerror = () => { playing.current = false; };
        audio.play().catch(() => { playing.current = false; });
      } catch { /* ignore */ }
    }, 500);
    return () => clearInterval(poll);
  }, [active]);

  if (!active) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', cursor: 'pointer' }} onClick={start}>
        <h1 style={{ fontSize: '6rem', color: '#0f0', fontFamily: 'monospace', textAlign: 'center' }}>CLICK HERE TO HEAR TTS</h1>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', color: '#0f0', fontFamily: 'monospace' }}>
      <p style={{ fontSize: '2rem' }}>🔊 Say Player Active — listening for messages</p>
    </div>
  );
}
