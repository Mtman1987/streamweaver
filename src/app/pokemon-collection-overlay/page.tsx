'use client';
import { useEffect, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

export default function PokemonCollectionOverlay() {
  const [cards, setCards] = useState<string[]>([]);
  const [username, setUsername] = useState('');

  useEffect(() => {
    const ws = new WebSocket(getBrowserWebSocketUrl());
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'pokemon-collection-show') {
        const payload = data.payload || data;
        const receivedCards = payload.cards || [];
        console.log('[Collection Overlay] Received cards:', receivedCards);
        setUsername(payload.username || '');
        setCards(receivedCards);
        runAnimation(receivedCards);
      }
    };

    return () => ws.close();
  }, []);

  const runAnimation = (cardIds: string[]) => {
    const container = document.getElementById('cardContainer');
    if (!container) return;
    
    container.innerHTML = '';
    let index = 0;
    
    const showBatch = () => {
      if (index >= cardIds.length) {
        index = 0;
      }
      
      const batch = cardIds.slice(index, index + 11);
      container.innerHTML = '';
      
      batch.forEach((cardId, i) => {
        const card = document.createElement('div');
        card.className = 'card real';
        const [setCode, number] = cardId.split('-');
        const cardUrl = `/api/pokemon-card-image?set=${setCode}&number=${number}&name=Unknown`;
        console.log('[Collection Overlay] Loading card:', cardUrl);
        card.innerHTML = `
          <div class="inner">
            <div class="back"></div>
            <img class="front" src="${cardUrl}" alt="Card" onerror="console.error('Failed to load:', this.src)">
          </div>`;
        container.appendChild(card);

        const fx = i < 3 ? 270 + i * 160 : 200 + (i - 3) * 160;
        const fy = i < 3 ? 190 : 360;

        card.style.transform = `translateX(${fx}px) translateY(-500px) translateZ(600px) scale(2.5)`;
        card.style.transition = 'transform 1200ms ease-out';

        setTimeout(() => {
          card.style.transform = `translateX(${fx}px) translateY(${fy}px) translateZ(0) scale(1)`;
        }, 20);

        setTimeout(() => card.classList.add('flipped'), 600 + Math.random() * 400);
      });
      
      index += 11;
      setTimeout(showBatch, 14000);
    };
    
    showBatch();
  };

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
