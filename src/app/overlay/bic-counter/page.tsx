'use client';

import { useEffect, useState, useRef } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

export default function BicCounterOverlay() {
  const [total, setTotal] = useState<number | null>(null);
  const [lastUser, setLastUser] = useState('');
  const [lastUserCount, setLastUserCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [burst, setBurst] = useState(false);
  const prevTotal = useRef(0);

  const fetchLatest = () =>
    fetch(`/api/bic-counter?ts=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null);

  // Load initial count from global API
  useEffect(() => {
    fetchLatest()
      .then(d => {
        if (d) {
          setTotal(d.total);
          setLastUser(d.lastUser || '');
          setLastUserCount(typeof d.lastUserCount === 'number' ? d.lastUserCount : null);
          prevTotal.current = d.total;
        }
      })
      .catch(() => {});
  }, []);

  // Listen for live updates via WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl());
        ws.onclose = () => { reconnect = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'overlay-update' && msg.payload?.type === 'bic-counter') {
              const newTotal = msg.payload.data?.total;
              if (typeof newTotal === 'number' && newTotal !== prevTotal.current) {
                prevTotal.current = newTotal;
                setTotal(newTotal);
                setLastUser(msg.payload.data?.lastUser || '');
                setLastUserCount(typeof msg.payload.data?.lastUserCount === 'number' ? msg.payload.data.lastUserCount : null);
                setFlash(true);
                setBurst(true);
                setTimeout(() => setFlash(false), 2000);
                setTimeout(() => setBurst(false), 1200);
              }
            }
          } catch {}
        };
      } catch {
        reconnect = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { clearTimeout(reconnect); ws?.close(); };
  }, []);

  // Also poll as fallback every 5s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLatest()
        .then(d => {
          if (d && d.total !== prevTotal.current) {
            prevTotal.current = d.total;
            setTotal(d.total);
            setLastUser(d.lastUser || '');
            setLastUserCount(typeof d.lastUserCount === 'number' ? d.lastUserCount : null);
            setFlash(true);
            setBurst(true);
            setTimeout(() => setFlash(false), 2000);
            setTimeout(() => setBurst(false), 1200);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      minWidth: 420,
      background: flash
        ? 'linear-gradient(135deg, rgba(255,69,0,0.96), rgba(255,140,0,0.92))'
        : 'linear-gradient(135deg, rgba(10,10,10,0.86), rgba(35,35,35,0.82))',
      borderRadius: 18,
      padding: '16px 22px',
      color: 'white',
      fontFamily: 'Impact, Haettenschweiler, sans-serif',
      border: '3px solid #FF7A00',
      boxShadow: burst
        ? '0 0 0 8px rgba(255,122,0,0.18), 0 0 30px rgba(255,122,0,0.65)'
        : '0 10px 30px rgba(0,0,0,0.4)',
      transform: burst ? 'scale(1.08)' : 'scale(1)',
      transition: 'background 0.25s ease, transform 0.2s ease, box-shadow 0.2s ease',
    }}>
      <div style={{
        fontSize: 16,
        letterSpacing: 2,
        opacity: 0.9,
        textTransform: 'uppercase',
      }}>
        Bic Theft Watch
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        marginTop: 2,
      }}>
        <span style={{ fontSize: 44, lineHeight: 1 }}>🔥</span>
        <span style={{ fontSize: 56, lineHeight: 1 }}>{total ?? 0}</span>
      </div>
      <div style={{
        fontSize: 18,
        marginTop: 4,
        opacity: 0.95,
      }}>
        total lighters stolen
      </div>
      <div style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '1px solid rgba(255,255,255,0.18)',
        fontSize: 20,
        letterSpacing: 0.5,
      }}>
        {lastUser
          ? `Latest victim: ${lastUser} (${lastUserCount ?? 0} stolen)`
          : 'Waiting for the next lighter theft'}
      </div>
      {burst && (
        <div style={{
          marginTop: 8,
          fontSize: 22,
          color: '#FFF4B1',
          textShadow: '0 0 10px rgba(255,244,177,0.45)',
        }}>
          +1 lighter stolen
        </div>
      )}
    </div>
  );
}
