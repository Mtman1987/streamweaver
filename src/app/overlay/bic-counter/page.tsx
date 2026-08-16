'use client';

import { useEffect, useState, useRef } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';

export default function BicCounterOverlay() {
  const [total, setTotal] = useState<number | null>(null);
  const [lastUser, setLastUser] = useState('');
  const [lastUserCount, setLastUserCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [burst, setBurst] = useState(false);
  const prevTotal = useRef(0);
  const tenantId = getOverlayTenantId();
  const tenantQuery = tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : '';

  const fetchLatest = () =>
    fetch(`/api/bic-counter?ts=${Date.now()}${tenantQuery}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null);

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
  }, [tenantQuery]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: NodeJS.Timeout;

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(tenantId || undefined));
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
  }, [tenantId]);

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
  }, [tenantQuery]);

  return (
    <div style={{
      position: 'fixed',
      bottom: 'clamp(6px, 2vh, 20px)',
      right: 'clamp(6px, 2vw, 20px)',
      width: 'min(420px, calc(100vw - 12px))',
      maxWidth: 'calc(100vw - 12px)',
      maxHeight: 'calc(100vh - 12px)',
      boxSizing: 'border-box',
      overflow: 'hidden',
      background: flash
        ? 'linear-gradient(135deg, rgba(255,69,0,0.96), rgba(255,140,0,0.92))'
        : 'linear-gradient(135deg, rgba(10,10,10,0.86), rgba(35,35,35,0.82))',
      borderRadius: 'clamp(10px, 3vw, 18px)',
      padding: 'clamp(8px, 2.2vw, 16px) clamp(10px, 3vw, 22px)',
      color: 'white',
      fontFamily: 'Impact, Haettenschweiler, sans-serif',
      border: 'clamp(1px, 0.6vw, 3px) solid #FF7A00',
      boxShadow: burst
        ? '0 0 0 6px rgba(255,122,0,0.14), 0 0 24px rgba(255,122,0,0.55)'
        : '0 10px 30px rgba(0,0,0,0.4)',
      transition: 'background 0.25s ease, box-shadow 0.2s ease',
    }}>
      <div style={{
        fontSize: 'clamp(10px, 3.4vw, 16px)',
        letterSpacing: 'clamp(1px, 0.5vw, 2px)',
        opacity: 0.9,
        textTransform: 'uppercase',
      }}>
        Bic Theft Watch
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'clamp(6px, 2vw, 12px)',
        marginTop: 2,
        minWidth: 0,
      }}>
        <span style={{ fontSize: 'clamp(26px, 10vw, 44px)', lineHeight: 1, flex: '0 0 auto' }}>🔥</span>
        <span style={{ fontSize: 'clamp(34px, 14vw, 56px)', lineHeight: 1, minWidth: 0 }}>{total ?? 0}</span>
      </div>
      <div style={{
        fontSize: 'clamp(11px, 4vw, 18px)',
        marginTop: 4,
        opacity: 0.95,
      }}>
        total lighters stolen
      </div>
      <div style={{
        marginTop: 'clamp(6px, 2vw, 10px)',
        paddingTop: 'clamp(6px, 2vw, 10px)',
        borderTop: '1px solid rgba(255,255,255,0.18)',
        fontSize: 'clamp(12px, 4.5vw, 20px)',
        letterSpacing: 0.5,
        overflowWrap: 'anywhere',
      }}>
        {lastUser
          ? `Latest victim: ${lastUser} (${lastUserCount ?? 0} stolen)`
          : 'Waiting for the next lighter theft'}
      </div>
      {burst && (
        <div style={{
          marginTop: 8,
          fontSize: 'clamp(13px, 5vw, 22px)',
          color: '#FFF4B1',
          textShadow: '0 0 10px rgba(255,244,177,0.45)',
        }}>
          +1 lighter stolen
        </div>
      )}
    </div>
  );
}
