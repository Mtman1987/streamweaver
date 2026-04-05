'use client';

import { useEffect, useState } from 'react';

interface BicData {
  total: number;
  lastUser: string;
  lastUserCount: number;
  timestamp: number;
}

export default function BicCounterOverlay() {
  const [data, setData] = useState<BicData | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let lastTimestamp = 0;

    const poll = async () => {
      try {
        const res = await fetch('/api/overlay/bic-counter');
        if (res.ok) {
          const json = await res.json();
          if (json.timestamp && json.timestamp !== lastTimestamp) {
            lastTimestamp = json.timestamp;
            setData(json);
            setFlash(true);
            setTimeout(() => setFlash(false), 2000);
          }
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!data) {
    return (
      <div style={{
        position: 'fixed', bottom: 20, right: 20,
        background: 'rgba(0,0,0,0.7)', borderRadius: 12,
        padding: '12px 24px', color: '#FF4500',
        fontFamily: 'Impact, sans-serif', fontSize: 36,
      }}>
        🔥 Lighters Stolen: 0
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20,
      background: flash ? 'rgba(255,69,0,0.9)' : 'rgba(0,0,0,0.7)',
      borderRadius: 12, padding: '12px 24px',
      color: 'white', fontFamily: 'Impact, sans-serif',
      fontSize: 36, transition: 'background 0.3s ease',
      border: '2px solid #FF4500',
    }}>
      🔥 Lighters Stolen: {data.total}
    </div>
  );
}
