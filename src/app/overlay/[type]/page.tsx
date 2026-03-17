'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function OverlayPage() {
  const params = useParams();
  const type = params.type as string;
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch(`/api/overlay/${type}`);
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (error) {
        console.error('Failed to load overlay data:', error);
      }
    };

    loadData();
    const interval = setInterval(loadData, 500);
    return () => clearInterval(interval);
  }, [type]);

  if (!data) return null;

  // DEBUG: Show raw data temporarily
  console.log('Overlay data:', data);

  // Render based on overlay type
  switch (type) {
    case 'notification':
      return <NotificationOverlay data={data} />;
    case 'gamble':
    case 'space-mountain':
      return <GambleOverlay data={data} />;
    case 'classic-gamble':
      return <ClassicGambleOverlay data={data} />;
    default:
      return <GenericOverlay data={data} />;
  }
}

// ════════════════════════════════════════════════
// 🔔 NOTIFICATION OVERLAY (Top-right, minimal)
// ════════════════════════════════════════════════
function NotificationOverlay({ data }: { data: any }) {
  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      right: '20px',
      background: 'rgba(0, 0, 0, 0.85)',
      border: '2px solid #fff',
      borderRadius: '8px',
      padding: '15px 20px',
      color: 'white',
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      maxWidth: '300px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      animation: 'slideIn 0.3s ease-out'
    }}>
      {data.icon && <span style={{ marginRight: '10px', fontSize: '24px' }}>{data.icon}</span>}
      <span>{data.message}</span>
      <style jsx>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ════════════════════════════════════════════════
// 🎲 GAMBLE OVERLAY (Center, compact)
// ════════════════════════════════════════════════
function GambleOverlay({ data }: { data: any }) {
  const payload = data.payload || {};
  const phase = payload.phase;
  const text = data.text || '';
  
  // Show prompts in a different style
  if (phase === 'double_prompt') {
    return (
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'rgba(0, 0, 0, 0.85)',
        border: '8px solid #FFD700',
        borderRadius: '24px',
        padding: '80px 160px',
        color: 'white',
        fontFamily: 'Arial, sans-serif',
        textAlign: 'center',
        fontSize: '72px',
        fontWeight: 'bold',
        boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
        minWidth: '800px'
      }}>
        Double or Nothing?
        <div style={{ fontSize: '48px', marginTop: '30px', opacity: 0.9 }}>Type !yes or !no</div>
      </div>
    );
  }
  
  // Hide other non-result phases
  if (phase === 'expired' || phase === 'bailout') {
    return null;
  }
  
  // Parse data for structured display
  const user = payload.user || 'Player';
  const roll = payload.roll || payload.reroll;
  const wager = payload.wager || payload.betAmount || 0;
  const multiplier = payload.multiplier;
  const net = payload.net;
  const change = payload.change || 0;
  const oldTotal = payload.oldTotal;
  const newTotal = payload.newTotal;
  const outcome = payload.outcome;
  
  // Determine win/loss
  let isWin = false;
  let amount = 0;
  let status = '';
  let pointChange = 0;
  
  if (outcome === 'jackpot') {
    isWin = true;
    status = 'JACKPOT!';
    amount = Math.abs(change);
    pointChange = change;
  } else if (outcome === 'win') {
    isWin = true;
    status = 'WON';
    amount = Math.abs(change);
    pointChange = change;
  } else if (outcome === 'loss') {
    status = 'LOST';
    amount = Math.abs(change);
    pointChange = change;
  } else if (net !== undefined) {
    // Double roll result
    amount = Math.abs(net);
    pointChange = net;
    if (net > 0) {
      isWin = true;
      status = 'WON';
    } else if (net === 0) {
      status = 'BROKE EVEN';
    } else {
      status = 'LOST';
    }
  } else if (change !== undefined && change !== 0) {
    // First roll result
    amount = Math.abs(change);
    pointChange = change;
    isWin = change > 0;
    status = isWin ? 'WON' : 'LOST';
  } else {
    // Fallback to text
    return (
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'linear-gradient(135deg, #4CAF50, #45a049)',
        border: '8px solid white',
        borderRadius: '24px',
        padding: '100px 200px',
        color: 'white',
        fontFamily: 'Arial, sans-serif',
        textAlign: 'center',
        fontSize: '56px',
        fontWeight: 'bold',
        boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
        minWidth: '1000px'
      }}>
        {text}
      </div>
    );
  }
  
  const bgColor = status === 'BROKE EVEN' ? 'linear-gradient(135deg, #FF9800, #F57C00)' :
                  isWin ? 'linear-gradient(135deg, #4CAF50, #45a049)' : 
                  'linear-gradient(135deg, #F44336, #d32f2f)';
  
  // Show result
  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: bgColor,
      border: '8px solid white',
      borderRadius: '24px',
      padding: '100px 200px',
      color: 'white',
      fontFamily: 'Arial, sans-serif',
      textAlign: 'center',
      boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
      animation: 'fadeIn 0.3s ease-out',
      minWidth: '1000px'
    }}>
      <div style={{ fontSize: '56px', marginBottom: '30px', opacity: 0.9 }}>{user}</div>
      {roll && <div style={{ fontSize: '48px', marginBottom: '20px' }}>Rolled: {roll}</div>}
      {multiplier !== undefined && <div style={{ fontSize: '48px', marginBottom: '20px' }}>Multiplier: x{multiplier}</div>}
      <div style={{ fontSize: '72px', fontWeight: 'bold', marginBottom: '20px' }}>
        {status}
      </div>
      {amount > 0 && (
        <div style={{ fontSize: '64px' }}>
          {pointChange > 0 ? '+' : ''}{pointChange.toLocaleString()} Points
        </div>
      )}
      {oldTotal !== undefined && newTotal !== undefined && (
        <div style={{ fontSize: '48px', marginTop: '20px', opacity: 0.8 }}>
          {oldTotal.toLocaleString()} → {newTotal.toLocaleString()}
        </div>
      )}
      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </div>
  );
}

// ════════════════════════════════════════════════
// 🎰 CLASSIC GAMBLE OVERLAY (Center, animated)
// ════════════════════════════════════════════════
function ClassicGambleOverlay({ data }: { data: any }) {
  const isJackpot = data.outcome === 'jackpot';
  const isWin = data.outcome === 'win';

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: isJackpot ? 'linear-gradient(135deg, #FFD700, #FFA500)' :
                 isWin ? 'linear-gradient(135deg, #4CAF50, #45a049)' :
                 'linear-gradient(135deg, #F44336, #d32f2f)',
      border: '4px solid white',
      borderRadius: '16px',
      padding: '40px 60px',
      color: 'white',
      fontFamily: 'Arial, sans-serif',
      textAlign: 'center',
      boxShadow: '0 10px 40px rgba(0,0,0,0.7)',
      animation: isJackpot ? 'pulse 0.5s infinite' : 'fadeIn 0.3s ease-out'
    }}>
      {isJackpot && (
        <div style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '15px', letterSpacing: '6px' }}>
          🎰 J A C K P O T 🎰
        </div>
      )}
      <div style={{ fontSize: '36px', fontWeight: 'bold', marginBottom: '15px' }}>
        {data.user}
      </div>
      <div style={{ fontSize: '28px', marginBottom: '10px' }}>
        {data.outcome === 'loss' ? 'Lost' : 'Won'} {data.amount?.toLocaleString()} {data.currency}
      </div>
      <div style={{ fontSize: '20px', opacity: 0.9 }}>
        New Total: {data.newTotal?.toLocaleString()} {data.currency}
      </div>
      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(1.05); }
        }
      `}</style>
    </div>
  );
}

// ════════════════════════════════════════════════
// 📦 GENERIC OVERLAY (Fallback)
// ════════════════════════════════════════════════
function GenericOverlay({ data }: { data: any }) {
  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(0, 0, 0, 0.9)',
      border: '2px solid white',
      borderRadius: '12px',
      padding: '30px 40px',
      color: 'white',
      fontFamily: 'Arial, sans-serif',
      textAlign: 'center',
      maxWidth: '500px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
    }}>
      <pre style={{ margin: 0, textAlign: 'left', fontSize: '14px' }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
