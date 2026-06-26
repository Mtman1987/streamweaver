'use client';

import { useEffect, useRef, useState } from 'react';

export default function SayPlayer() {
  const speaking = useRef(false);
  const [active, setActive] = useState(false);

  function start() {
    setActive(true);
    // Unlock browser audio with a silent utterance
    const unlock = new SpeechSynthesisUtterance('');
    speechSynthesis.speak(unlock);
  }

  useEffect(() => {
    if (!active) return;
    const poll = setInterval(async () => {
      if (speaking.current) return;
      try {
        const res = await fetch('/api/say/next');
        const { text } = await res.json();
        if (!text) return;
        speaking.current = true;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => { speaking.current = false; };
        utterance.onerror = () => { speaking.current = false; };
        speechSynthesis.speak(utterance);
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
