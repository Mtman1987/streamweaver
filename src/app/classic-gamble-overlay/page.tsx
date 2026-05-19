'use client';

import { useEffect, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';

export default function ClassicGambleOverlay() {
  const [data, setData] = useState<any>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;
    let hideTimer: NodeJS.Timeout;

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        ws.onclose = () => { reconnect = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'gamble-result') {
              setData(msg.payload);
              setVisible(true);
              clearTimeout(hideTimer);
              hideTimer = setTimeout(() => setVisible(false), 8000);
            }
          } catch {}
        };
      } catch {
        reconnect = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { clearTimeout(reconnect); clearTimeout(hideTimer); ws?.close(); };
  }, []);

  if (!visible || !data?.payload) return null;

  const { user, outcome, amount, newTotal, currency } = data.payload;
  const amountDisplay = data.payload.displayAmountDisplay || data.payload.amountDisplay || amount || '0';
  const totalDisplay = data.payload.newTotalDisplay || newTotal || '0';
  const isJackpot = outcome === 'jackpot';
  const isWin = outcome === 'win';
  const isLoss = outcome === 'loss';

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Segoe UI", Arial, sans-serif', background: 'transparent'
    }}>
      <div style={{
        background: isJackpot ? 'linear-gradient(135deg, #FFD700, #FFA500)' :
                   isWin ? 'linear-gradient(135deg, #4CAF50, #45a049)' :
                   'linear-gradient(135deg, #F44336, #d32f2f)',
        border: '4px solid white', borderRadius: 20,
        padding: '40px 60px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        textAlign: 'center', animation: isJackpot ? 'pulse 0.5s infinite' : 'fadeIn 0.3s ease-out'
      }}>
        {isJackpot && (
          <div style={{ fontSize: 32, fontWeight: 'bold', color: 'white', textShadow: '2px 2px 4px rgba(0,0,0,0.5)', marginBottom: 20, letterSpacing: 8 }}>
            🎰 J A C K P O T 🎰
          </div>
        )}
        <div style={{ fontSize: 48, fontWeight: 'bold', color: 'white', textShadow: '3px 3px 6px rgba(0,0,0,0.5)', marginBottom: 10 }}>
          {user}
        </div>
        <div style={{ fontSize: 36, color: 'white', textShadow: '2px 2px 4px rgba(0,0,0,0.5)', marginBottom: 20 }}>
          {isLoss ? 'Lost' : 'Won'} {amountDisplay} {currency}
        </div>
        <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.9)', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>
          New Total: {totalDisplay} {currency}
        </div>
      </div>
      <style>{`
        @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
        @keyframes fadeIn { from{opacity:0;transform:scale(0.8)} to{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}
