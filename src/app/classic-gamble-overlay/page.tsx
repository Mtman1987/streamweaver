'use client';

import { useEffect, useState } from 'react';

export default function ClassicGambleOverlay() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch('/api/classic-gamble/overlay-data');
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (error) {
        console.error('Failed to load gamble data:', error);
      }
    };

    loadData();
    const interval = setInterval(loadData, 500);
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;

  const isJackpot = data.outcome === 'jackpot';
  const isWin = data.outcome === 'win';
  const isLoss = data.outcome === 'loss';

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Segoe UI", Arial, sans-serif',
      background: 'transparent'
    }}>
      <div style={{
        background: isJackpot ? 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)' :
                   isWin ? 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)' :
                   'linear-gradient(135deg, #F44336 0%, #d32f2f 100%)',
        border: '4px solid white',
        borderRadius: '20px',
        padding: '40px 60px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        textAlign: 'center',
        animation: isJackpot ? 'pulse 0.5s infinite' : 'none'
      }}>
        {isJackpot && (
          <div style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: 'white',
            textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
            marginBottom: '20px',
            letterSpacing: '8px'
          }}>
            🎰 J A C K P O T 🎰
          </div>
        )}

        <div style={{
          fontSize: '48px',
          fontWeight: 'bold',
          color: 'white',
          textShadow: '3px 3px 6px rgba(0,0,0,0.5)',
          marginBottom: '10px'
        }}>
          {data.user}
        </div>

        <div style={{
          fontSize: '36px',
          color: 'white',
          textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
          marginBottom: '20px'
        }}>
          {isLoss ? 'Lost' : 'Won'} {data.amount.toLocaleString()} {data.currency}
        </div>

        <div style={{
          fontSize: '24px',
          color: 'rgba(255,255,255,0.9)',
          textShadow: '1px 1px 2px rgba(0,0,0,0.5)'
        }}>
          New Total: {data.newTotal.toLocaleString()} {data.currency}
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
