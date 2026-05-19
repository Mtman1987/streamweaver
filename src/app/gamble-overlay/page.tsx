'use client';

import { useEffect, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';

export default function GambleOverlay() {
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
            if (msg.type === 'gamble-result' || msg.type === 'roll-result' || msg.type === 'double-result' || msg.type === 'steal-result') {
              setData(msg);
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

  const p = data.payload?.payload || data.payload;
  const eventType = data.type;
  const user = p.user || p.playerName || '';
  const newTotal = p.newTotal ?? 0;
  const change = p.change ?? 0;
  const changeDisplay = p.changeDisplay || `${String(change).startsWith('-') ? '' : '+'}${change}`;
  const newTotalDisplay = p.newTotalDisplay || String(newTotal);
  let oldTotalDisplay = '0';
  try {
    oldTotalDisplay = (BigInt(newTotal) - BigInt(change)).toLocaleString();
  } catch {
    oldTotalDisplay = String((Number(newTotal) || 0) - (Number(change) || 0));
  }
  const numericChange = Number(change);

  let title = '';
  let isJackpot = false;
  let isWin = false;

  if (eventType === 'gamble-result') {
    isJackpot = p.outcome === 'jackpot';
    isWin = p.outcome === 'win';
    title = isJackpot ? '🎰 JACKPOT!' : isWin ? '🎉 WON!' : '💀 LOST!';
  } else if (eventType === 'roll-result') {
    isWin = numericChange > 0;
    isJackpot = p.roll === 6;
    title = isJackpot ? '🎲 JACKPOT ROLL!' : isWin ? `🎲 Rolled ${p.roll}!` : `🎲 Rolled ${p.roll}!`;
  } else if (eventType === 'double-result') {
    isWin = p.won;
    title = isWin ? '🔥 DOUBLE WIN!' : '💀 DOUBLE FAIL!';
  } else if (eventType === 'steal-result') {
    isWin = numericChange > 0;
    title = isWin ? '💰 STOLEN!' : '💰 STEAL FAILED!';
  }

  const bgColor = isJackpot ? 'linear-gradient(135deg, #FFD700, #FFA500)' :
                  isWin ? 'linear-gradient(135deg, #4CAF50, #45a049)' :
                  'linear-gradient(135deg, #F44336, #d32f2f)';

  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Segoe UI", Arial, sans-serif', background: 'transparent'
    }}>
      <div style={{
        background: bgColor, border: '8px solid white', borderRadius: 24,
        padding: '80px 160px', color: 'white', textAlign: 'center',
        boxShadow: '0 16px 48px rgba(0,0,0,0.8)', minWidth: 800,
        animation: isJackpot ? 'pulse 0.5s infinite' : 'fadeIn 0.3s ease-out'
      }}>
        <div style={{ fontSize: 56, marginBottom: 30, opacity: 0.9 }}>{user}</div>
        <div style={{ fontSize: 72, fontWeight: 'bold', marginBottom: 20 }}>
          {title}
        </div>
        <div style={{ fontSize: 64 }}>
          {changeDisplay} Points
        </div>
        <div style={{ fontSize: 48, marginTop: 20, opacity: 0.8 }}>
          {oldTotalDisplay} → {newTotalDisplay}
        </div>
      </div>
      <style>{`
        @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
        @keyframes fadeIn { from{opacity:0;transform:scale(0.8)} to{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}
