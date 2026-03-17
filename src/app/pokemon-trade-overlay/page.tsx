'use client';
import { useEffect, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

interface TradeCard {
  name: string;
  number: string;
  setCode: string;
  imageUrl?: string;
}

interface TradeData {
  type: string;
  userA: string;
  userB: string;
  avatarA?: string;
  avatarB?: string;
  cardA: TradeCard;
  cardB: TradeCard;
}

export default function PokemonTradeOverlay() {
  const [trade, setTrade] = useState<TradeData | null>(null);
  const [phase, setPhase] = useState<'hidden' | 'preview' | 'slide' | 'flash' | 'done'>('hidden');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl());
        ws.onopen = () => console.log('[Trade Overlay] Connected');
        ws.onclose = () => { reconnectTimeout = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'pokemon-trade-preview') {
              setTrade(data);
              setPhase('preview');
            } else if (data.type === 'pokemon-trade-execute') {
              setTrade(prev => ({ ...data, avatarA: data.avatarA || prev?.avatarA, avatarB: data.avatarB || prev?.avatarB }));
              setPhase('preview');
              setTimeout(() => setPhase('slide'), 1500);
              setTimeout(() => setPhase('flash'), 4000);
              setTimeout(() => setPhase('done'), 4500);
              setTimeout(() => { setPhase('hidden'); setTrade(null); }, 9000);
            }
          } catch {}
        };
      } catch {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { clearTimeout(reconnectTimeout); ws?.close(); };
  }, []);

  if (!trade || phase === 'hidden') return null;

  // After flash, cards have swapped sides
  const swapped = phase === 'done';
  const leftCard = swapped ? trade.cardB : trade.cardA;
  const rightCard = swapped ? trade.cardA : trade.cardB;
  const leftUrl = leftCard.imageUrl || `https://images.pokemontcg.io/${leftCard.setCode}/${leftCard.number}_hires.png`;
  const rightUrl = rightCard.imageUrl || `https://images.pokemontcg.io/${rightCard.setCode}/${rightCard.number}_hires.png`;

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'transparent' }}>
      {/* User A side */}
      <div style={{
        position: 'absolute', left: '10%', top: '10%', textAlign: 'center',
      }}>
        {trade.avatarA && (
          <img src={trade.avatarA} alt="" style={{ width: 128, height: 128, borderRadius: '50%', border: '4px solid #ffd700', marginBottom: 10, boxShadow: '0 4px 20px rgba(255,215,0,0.5)' }} />
        )}
        <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'white', textShadow: '2px 2px 6px black', marginBottom: '12px' }}>
          {trade.userA}
        </div>
        <div style={{
          width: '220px', height: '308px',
          transition: 'transform 1.5s ease-in-out',
          transform: phase === 'slide' ? 'translateX(calc(40vw - 110px))' : 'translateX(0)',
        }}>
          <img src={leftUrl} alt={leftCard.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}
          />
        </div>
        <div style={{ fontSize: '18px', color: '#ddd', marginTop: '8px', textShadow: '1px 1px 4px black' }}>
          {leftCard.name}
        </div>
      </div>

      {/* User B side */}
      <div style={{
        position: 'absolute', right: '10%', top: '10%', textAlign: 'center',
      }}>
        {trade.avatarB && (
          <img src={trade.avatarB} alt="" style={{ width: 128, height: 128, borderRadius: '50%', border: '4px solid #ffd700', marginBottom: 10, boxShadow: '0 4px 20px rgba(255,215,0,0.5)' }} />
        )}
        <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'white', textShadow: '2px 2px 6px black', marginBottom: '12px' }}>
          {trade.userB}
        </div>
        <div style={{
          width: '220px', height: '308px',
          transition: 'transform 1.5s ease-in-out',
          transform: phase === 'slide' ? 'translateX(calc(-40vw + 110px))' : 'translateX(0)',
        }}>
          <img src={rightUrl} alt={rightCard.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}
          />
        </div>
        <div style={{ fontSize: '18px', color: '#ddd', marginTop: '8px', textShadow: '1px 1px 4px black' }}>
          {rightCard.name}
        </div>
      </div>

      {/* Trade arrow */}
      <div style={{
        position: 'absolute', top: '45%', left: '50%', transform: 'translate(-50%, -50%)',
        fontSize: '64px', fontWeight: 'bold', color: '#FFD700',
        textShadow: '0 0 20px rgba(255,215,0,0.8), 3px 3px 8px black',
        opacity: phase === 'preview' ? 1 : 0,
        transition: 'opacity 0.5s'
      }}>
        ↔
      </div>

      {/* Flash */}
      {phase === 'flash' && (
        <div style={{
          position: 'fixed', inset: 0, background: 'white', opacity: 0.8,
          animation: 'flashFade 0.5s forwards', zIndex: 5
        }} />
      )}

      {/* Trade complete banner */}
      {phase === 'done' && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: '56px', fontWeight: 'bold', color: '#FFD700',
          textShadow: '0 0 30px rgba(255,215,0,0.8), 4px 4px 10px black',
          animation: 'popIn 0.5s ease-out', zIndex: 10
        }}>
          ✅ TRADE COMPLETE!
        </div>
      )}

      <style jsx>{`
        @keyframes flashFade { from { opacity: 0.8; } to { opacity: 0; } }
        @keyframes popIn { from { transform: translate(-50%, -50%) scale(0.5); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}
