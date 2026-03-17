'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import CardBack from '@/components/CardBack';

interface Card {
  number: string;
  name: string;
  rarity: string;
  setCode: string;
  imageUrl: string;
  id?: string;
}

export default function PokemonPackOverlay() {
  const [pack, setPack] = useState<Card[]>([]);
  const [setName, setSetName] = useState('');
  const [username, setUsername] = useState('');
  const [phase, setPhase] = useState<'hidden' | 'stack' | 'deal' | 'flip' | 'rare'>('hidden');
  const avatarUrl = useRef('');

  useEffect(() => {
    fetch('/api/user-profile').then(r => r.json()).then(d => {
      if (d.twitch?.avatar) avatarUrl.current = d.twitch.avatar;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;
    
    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl());
        
        ws.onopen = () => {
          console.log('[Pokemon Overlay] WebSocket connected');
        };
        
        ws.onerror = (error) => {
          console.error('[Pokemon Overlay] WebSocket error:', error);
        };
        
        ws.onclose = () => {
          console.log('[Pokemon Overlay] WebSocket closed, reconnecting in 3s...');
          reconnectTimeout = setTimeout(connect, 3000);
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('[Pokemon Overlay] Received message:', data);
            if (data.type === 'pokemon-pack-opened') {
              console.log('[Pokemon Overlay] Pack opened!', data.payload);
              const { pack, setName, username } = data.payload;
              console.log('[Pokemon Overlay] Cards:', pack.map((c: any) => `${c.name} (${c.setCode}-${c.number})`));
              setPack(pack);
              setSetName(setName);
              setUsername(username);
              setPhase('stack');
              
              setTimeout(() => setPhase('deal'), 800);
              setTimeout(() => setPhase('flip'), 2000);
              setTimeout(() => setPhase('rare'), 6000);
              setTimeout(() => {
                setPhase('hidden');
                setPack([]);
                setSetName('');
                setUsername('');
              }, 12000);
            }
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        };
      } catch (error) {
        console.error('[Pokemon Overlay] Failed to connect:', error);
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };
    
    connect();
    
    return () => {
      clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);

  if (phase === 'hidden' || pack.length === 0) return null;

  // Pack: 4 common, 3 uncommon, 1 rare, 1 energy/trainer = 9 cards
  // Show first 8 as grid, last card (rare slot) as the big reveal
  // Sort so rarest card is last for the big reveal
  const rarityOrder: Record<string, number> = { 'Common': 0, 'Uncommon': 1, 'Rare': 2, 'Rare Holo': 3, 'Rare Holo EX': 4, 'Rare Ultra': 5, 'Rare Secret': 6 };
  const sorted = [...pack].sort((a, b) => (rarityOrder[a.rarity] ?? 1) - (rarityOrder[b.rarity] ?? 1));
  const gridCards = sorted.slice(0, sorted.length - 1);
  const rareCard = sorted[sorted.length - 1];

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-transparent">
      <h1 className="text-5xl font-bold text-white mb-8 drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)] animate-in fade-in duration-500">
        {username} opened a {setName} pack!
      </h1>
      
      <div className="relative w-[1400px] h-[700px]">
        {gridCards.map((card, index) => {
          const row = Math.floor(index / 4);
          const col = index % 4;
          const isStack = phase === 'stack';
          const isDeal = phase === 'deal';
          const isFlip = phase === 'flip' || phase === 'rare';
          
          return (
            <div
              key={index}
              className="absolute transition-all duration-700 ease-out"
              style={{
                left: isStack ? '50%' : `${col * 280 + 150}px`,
                top: isStack ? '50%' : `${row * 350 + 50}px`,
                transform: isStack 
                  ? `translate(-50%, -50%) rotate(${(index - 5) * 3}deg)`
                  : 'translate(0, 0) rotate(0deg)',
                zIndex: isStack ? 10 - index : index,
                transitionDelay: isDeal ? `${index * 0.08}s` : '0s'
              }}
            >
              <div 
                className="relative w-[240px] h-[336px]"
                style={{
                  transformStyle: 'preserve-3d',
                  transform: isFlip ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  transition: 'transform 0.6s',
                  transitionDelay: isFlip ? `${index * 0.1}s` : '0s'
                }}
              >
                <div className="absolute inset-0 backface-hidden rounded-xl shadow-2xl">
                  <CardBack width={240} height={336} avatarUrl={avatarUrl.current} />
                </div>
                <div className="absolute inset-0 backface-hidden rounded-xl bg-white shadow-2xl" style={{ transform: 'rotateY(180deg)' }}>
                  <img
                    src={card.imageUrl}
                    alt={card.name}
                    className="w-full h-full object-cover rounded-xl"
                  />
                </div>
              </div>
            </div>
          );
        })}

        {rareCard && (
          <div
            className="absolute transition-all duration-1000 ease-out"
            style={{
              left: '50%',
              top: phase === 'rare' ? '50%' : '150%',
              transform: phase === 'rare' ? 'translate(-50%, -50%) scale(1.8)' : 'translate(-50%, -50%) scale(0.5)',
              zIndex: 100,
              opacity: phase === 'rare' ? 1 : 0,
              pointerEvents: 'none'
            }}
          >
            <div 
              className="relative w-[240px] h-[336px]"
              style={{
                transformStyle: 'preserve-3d',
                transform: phase === 'rare' ? 'rotateY(180deg)' : 'rotateY(0deg)',
                transition: 'transform 0.8s 0.3s'
              }}
            >
              <div className="absolute inset-0 backface-hidden rounded-xl shadow-2xl">
                <CardBack width={240} height={336} avatarUrl={avatarUrl.current} />
              </div>
              <div className="absolute inset-0 backface-hidden rounded-xl bg-white shadow-2xl" style={{ transform: 'rotateY(180deg)' }}>
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-yellow-400 via-transparent to-purple-400 opacity-30 animate-pulse" />
                <img
                  src={rareCard.imageUrl}
                  alt={rareCard.name}
                  className="w-full h-full object-cover rounded-xl"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .backface-hidden {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
      `}</style>
    </div>
  );
}
