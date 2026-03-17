'use client';

import { useEffect, useState } from 'react';

export default function GambleOverlay() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch('/api/gamble/overlay-data');
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (error) {
        console.error('Failed to load gamble data:', error);
      }
    };

    loadData();
    const interval = setInterval(loadData, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: 'radial-gradient(circle at center, #1a0033 0%, #000000 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Orbitron", monospace',
      color: '#fff',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Animated stars */}
      <div style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        background: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Ccircle cx=\'10\' cy=\'10\' r=\'1\' fill=\'white\' opacity=\'0.3\'/%3E%3Ccircle cx=\'50\' cy=\'30\' r=\'1\' fill=\'white\' opacity=\'0.5\'/%3E%3Ccircle cx=\'80\' cy=\'70\' r=\'1\' fill=\'white\' opacity=\'0.4\'/%3E%3C/svg%3E")',
        animation: 'twinkle 3s infinite'
      }} />

      <div style={{
        background: 'rgba(0, 0, 0, 0.8)',
        border: '2px solid #9B59FF',
        borderRadius: '20px',
        padding: '40px 60px',
        boxShadow: '0 0 40px rgba(155, 89, 255, 0.6)',
        textAlign: 'center',
        zIndex: 1
      }}>
        <div style={{
          fontSize: '24px',
          color: '#9B59FF',
          marginBottom: '20px',
          textTransform: 'uppercase',
          letterSpacing: '3px'
        }}>
          🎲 Space Mountain
        </div>

        <div style={{
          fontSize: '48px',
          fontWeight: 'bold',
          marginBottom: '20px',
          textShadow: '0 0 20px rgba(155, 89, 255, 0.8)'
        }}>
          {data.text}
        </div>

        {data.payload && (
          <div style={{
            fontSize: '20px',
            color: '#aaa',
            marginTop: '20px'
          }}>
            {data.payload.phase === 'first_roll' && (
              <>
                <div>Roll: {data.payload.roll}</div>
                <div>Wager: {data.payload.wager}</div>
                <div style={{ color: data.payload.win ? '#4CAF50' : '#F44336' }}>
                  {data.payload.win ? 'WIN' : 'LOSS'}
                </div>
              </>
            )}
            {data.payload.phase === 'double_roll' && (
              <>
                <div>Re-roll: {data.payload.reroll}</div>
                <div>Multiplier: x{data.payload.multiplier}</div>
                <div style={{ color: data.payload.net > 0 ? '#4CAF50' : data.payload.net < 0 ? '#F44336' : '#FFC107' }}>
                  {data.payload.net > 0 ? `+${data.payload.net}` : data.payload.net}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
