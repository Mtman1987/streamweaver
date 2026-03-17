'use client';
import { useEffect, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

interface ShowCard {
  imageUrl: string;
  name: string;
  number: string;
  setCode: string;
  rarity: string;
  hp?: string;
  types?: string[];
  attacks?: { name: string; damage: string | number }[];
  weaknesses?: { type: string }[];
  username: string;
  owned: number;
}

export default function PokemonCollectionOverlay() {
  const [cards, setCards] = useState<string[]>([]);
  const [username, setUsername] = useState('');
  const [showCard, setShowCard] = useState<ShowCard | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;
    let hideTimeout: NodeJS.Timeout;

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl());
        ws.onopen = () => console.log('[Collection Overlay] Connected');
        ws.onclose = () => { reconnectTimeout = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'pokemon-collection-show') {
              const payload = data.payload || data;
              setShowCard(null);
              setUsername(payload.username || '');
              setCards(payload.cards || []);
              runAnimation(payload.cards || []);
            }
            if (data.type === 'pokemon-show-card') {
              setCards([]);
              setShowCard(data.payload);
              clearTimeout(hideTimeout);
              hideTimeout = setTimeout(() => setShowCard(null), 12000);
            }
          } catch {}
        };
      } catch {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { clearTimeout(reconnectTimeout); clearTimeout(hideTimeout); ws?.close(); };
  }, []);

  const runAnimation = (cardData: any[]) => {
    const container = document.getElementById('cardContainer');
    if (!container) return;

    container.innerHTML = '';
    let index = 0;

    const showBatch = () => {
      if (index >= cardData.length) {
        container.innerHTML = '';
        return;
      }

      const batch = cardData.slice(index, index + 11);
      container.innerHTML = '';

      batch.forEach((card, i) => {
        const el = document.createElement('div');
        el.className = 'card real';
        const imgUrl = typeof card === 'string'
          ? `https://images.pokemontcg.io/${card.split('-')[0]}/${card.split('-')[1]}_hires.png`
          : (card.imageUrl || `https://images.pokemontcg.io/${card.setCode}/${card.number}_hires.png`);
        el.innerHTML = `
          <div class="inner">
            <div class="back"></div>
            <img class="front" src="${imgUrl}" alt="${typeof card === 'string' ? 'Card' : card.name}" onerror="this.src='https://images.pokemontcg.io/${typeof card === 'string' ? card.replace('-','/') : card.setCode + '/' + card.number}.png'">
          </div>`;
        container.appendChild(el);

        const fx = i < 3 ? 270 + i * 160 : 200 + (i - 3) * 160;
        const fy = i < 3 ? 190 : 360;

        el.style.transform = `translateX(${fx}px) translateY(-500px) translateZ(600px) scale(2.5)`;
        el.style.transition = 'transform 1200ms ease-out';

        setTimeout(() => {
          el.style.transform = `translateX(${fx}px) translateY(${fy}px) translateZ(0) scale(1)`;
        }, 20);

        setTimeout(() => el.classList.add('flipped'), 600 + Math.random() * 400);
      });

      index += 11;
      setTimeout(showBatch, 14000);
    };

    showBatch();
  };

  // Show single card view
  if (showCard) {
    const isHolo = showCard.rarity?.includes('Holo');
    return (
      <div style={{ margin: 0, width: '100vw', height: '100vh', background: 'transparent', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: 40, alignItems: 'center', animation: 'fadeIn 0.5s ease-out' }}>
          <div style={{ position: 'relative' }}>
            {isHolo && <div style={{ position: 'absolute', inset: -4, borderRadius: 16, background: 'linear-gradient(135deg, #ffd700, #ff6b6b, #a855f7, #3b82f6, #ffd700)', opacity: 0.7, animation: 'holoSpin 3s linear infinite', filter: 'blur(8px)' }} />}
            <img src={showCard.imageUrl} alt={showCard.name} style={{ width: 300, height: 420, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', position: 'relative', zIndex: 1 }} />
          </div>
          <div style={{ color: 'white', textShadow: '0 2px 8px rgba(0,0,0,0.9)', maxWidth: 350 }}>
            <div style={{ fontSize: 36, fontWeight: 'bold', marginBottom: 8 }}>{showCard.name}</div>
            <div style={{ fontSize: 20, opacity: 0.8, marginBottom: 16 }}>{showCard.rarity} • #{showCard.number} • {showCard.setCode}</div>
            {showCard.hp && <div style={{ fontSize: 22, marginBottom: 8 }}>❤️ HP: {showCard.hp}</div>}
            {showCard.types && showCard.types.length > 0 && <div style={{ fontSize: 20, marginBottom: 8 }}>⚡ Type: {showCard.types.join('/')}</div>}
            {showCard.attacks && showCard.attacks.length > 0 && <div style={{ fontSize: 18, marginBottom: 8 }}>⚔️ {showCard.attacks.map(a => `${a.name} (${a.damage})`).join(', ')}</div>}
            {showCard.weaknesses && showCard.weaknesses.length > 0 && <div style={{ fontSize: 18, marginBottom: 8 }}>🔻 Weak: {showCard.weaknesses.map(w => w.type).join('/')}</div>}
            <div style={{ fontSize: 18, marginTop: 12, opacity: 0.7 }}>Owned by {showCard.username}: {showCard.owned}x</div>
          </div>
        </div>
        <style jsx global>{`
          @keyframes fadeIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
          @keyframes holoSpin { 0% { filter: blur(8px) hue-rotate(0deg); } 100% { filter: blur(8px) hue-rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // Collection grid view
  return (
    <div style={{ margin: 0, width: '100vw', height: '100vh', background: 'transparent', overflow: 'hidden' }}>
      <div id="cardContainer" style={{ position: 'relative', width: '100%', height: '100%', perspective: '1200px' }} />

      <style jsx global>{`
        .card { position: absolute; width: 140px; height: 200px; transform-origin: center bottom; z-index: 1; opacity: 1; }
        .card.real { z-index: 2; }
        .inner { width: 100%; height: 100%; transform-style: preserve-3d; transition: transform 0.6s ease-in-out; }
        .card.flipped .inner { transform: rotateY(180deg); }
        .front, .back { position: absolute; width: 100%; height: 100%; backface-visibility: hidden; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); background-size: cover; background-position: center; }
        .back { background: linear-gradient(135deg, #1a3a6e 0%, #2563eb 40%, #1e40af 60%, #1a3a6e 100%); box-shadow: inset 0 0 20px rgba(0,0,0,0.4); }
        .front { transform: rotateY(180deg); }
      `}</style>
    </div>
  );
}
