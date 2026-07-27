'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';
import { getOverlayTenantId } from '@/lib/client-tenant';
import CardBack from '@/components/CardBack';

interface Card {
  number: string;
  name: string;
  rarity: string;
  setCode: string;
  imageUrl: string;
  id?: string;
  hp?: string;
  types?: string[];
  attacks?: { name: string; damage: string | number }[];
  weaknesses?: { type: string }[];
  username?: string;
  owned?: number;
}

interface GeneratedImage {
  username: string;
  prompt: string;
  imageUrl: string;
}

export default function PokemonPackOverlay() {
  const [pack, setPack] = useState<Card[]>([]);
  const [setName, setSetName] = useState('');
  const [username, setUsername] = useState('');
  const [showCard, setShowCard] = useState<Card | null>(null);
  const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(null);
  const [phase, setPhase] = useState<'hidden' | 'stack' | 'deal' | 'flip' | 'rare'>('hidden');
  const avatarUrl = useRef('');

  useEffect(() => {
    const tenantId = getOverlayTenantId();
    const tenantParam = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
    fetch(`/api/user-profile${tenantParam}`).then(r => r.json()).then(d => {
      if (d.twitch?.avatar) avatarUrl.current = d.twitch.avatar;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;
    
    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl(getOverlayTenantId() || undefined));
        
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
              setShowCard(null);
              setGeneratedImage(null);
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
            if (data.type === 'pokemon-show-card') {
              console.log('[Pokemon Overlay] Show card!', data.payload);
              setPack([]);
              setSetName('');
              setUsername('');
              setPhase('hidden');
              setGeneratedImage(null);
              setShowCard(data.payload);
              setTimeout(() => setShowCard(null), 12000);
            }
            if (data.type === 'public-image-generated') {
              const imageUrl = String(data.payload?.imageUrl || '').trim();
              if (!imageUrl) return;
              setPack([]);
              setSetName('');
              setUsername('');
              setPhase('hidden');
              setShowCard(null);
              setGeneratedImage({
                username: String(data.payload?.username || 'viewer'),
                prompt: String(data.payload?.prompt || 'Generated image'),
                imageUrl,
              });
              setTimeout(() => setGeneratedImage(null), 15000);
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

  if (generatedImage) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-transparent p-[3vh]">
        <div className="relative flex max-h-[94vh] max-w-[94vw] items-center justify-center overflow-hidden rounded-3xl border border-cyan-300/50 bg-slate-950/85 p-4 text-white shadow-[0_20px_100px_rgba(34,211,238,0.35)] animate-in fade-in zoom-in duration-500">
          <img
            src={generatedImage.imageUrl}
            alt={generatedImage.prompt}
            className="max-h-[90vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
          />
          <div className="absolute inset-x-4 bottom-4 rounded-b-2xl bg-gradient-to-t from-slate-950 via-slate-950/85 to-transparent px-8 pb-7 pt-16 drop-shadow-[0_4px_14px_rgba(0,0,0,0.95)]">
            <div className="mb-2 text-4xl font-black text-cyan-300">
              Generated by @{generatedImage.username}
            </div>
            <div className="line-clamp-2 text-2xl leading-relaxed">{generatedImage.prompt}</div>
          </div>
        </div>
      </div>
    );
  }

  if (showCard) {
    const isHolo = showCard.rarity?.includes('Holo') || showCard.rarity?.includes('Rainbow') || showCard.rarity?.includes('Secret');
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-transparent">
        <div className="flex items-center gap-10 animate-in fade-in zoom-in duration-500">
          <div className="relative">
            {isHolo && (
              <div className="absolute -inset-3 rounded-2xl bg-gradient-to-br from-yellow-300 via-fuchsia-400 to-cyan-400 opacity-70 blur-xl animate-pulse" />
            )}
            <img
              src={showCard.imageUrl}
              alt={showCard.name}
              className="relative z-10 w-[360px] h-[504px] rounded-2xl object-cover shadow-[0_16px_60px_rgba(0,0,0,0.75)]"
            />
          </div>
          <div className="max-w-[520px] text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.95)]">
            <div className="text-5xl font-black mb-3">{showCard.name}</div>
            <div className="text-2xl opacity-90 mb-5">
              {showCard.rarity} • #{showCard.number} • {showCard.setCode}
            </div>
            {showCard.hp && <div className="text-3xl mb-2">HP {showCard.hp}</div>}
            {showCard.types?.length ? <div className="text-2xl mb-2">Type: {showCard.types.join('/')}</div> : null}
            {showCard.attacks?.length ? (
              <div className="text-xl mb-2">
                {showCard.attacks.map((attack) => `${attack.name} (${attack.damage || 0})`).join(' • ')}
              </div>
            ) : null}
            {showCard.weaknesses?.length ? (
              <div className="text-xl mb-4">Weak: {showCard.weaknesses.map((weakness) => weakness.type).join('/')}</div>
            ) : null}
            <div className="text-xl opacity-80">
              {showCard.username ? `Owned by ${showCard.username}` : 'Owned card'}
              {showCard.owned ? ` • ${showCard.owned}x` : ''}
            </div>
          </div>
        </div>
      </div>
    );
  }

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
