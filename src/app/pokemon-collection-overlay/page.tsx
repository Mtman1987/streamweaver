'use client';
import { useEffect, useRef, useState } from 'react';
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
  const [username, setUsername] = useState('');
  const [cardCount, setCardCount] = useState(0);
  const [showCard, setShowCard] = useState<ShowCard | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const scrollRef = useRef<number>(0);
  const avatarRef = useRef('');

  useEffect(() => {
    fetch('/api/user-profile').then(r => r.json()).then(d => {
      if (d.twitch?.avatar) avatarRef.current = d.twitch.avatar;
    }).catch(() => {});
  }, []);

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
              setCardCount((payload.cards || []).length);
              setScrolling(true);
              runAnimation(payload.cards || [], payload.username || '');
            }
            if (data.type === 'pokemon-show-card') {
              setScrolling(false);
              cancelAnimationFrame(scrollRef.current);
              const container = document.getElementById('cardContainer');
              if (container) { container.innerHTML = ''; container.style.transform = ''; }
              setUsername('');
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

  const runAnimation = (cardData: any[], user: string) => {
    const container = document.getElementById('cardContainer');
    if (!container) return;
    container.innerHTML = '';
    cancelAnimationFrame(scrollRef.current);

    const cardW = 170;
    const cardH = 238;
    const gapX = 12;
    const gapY = 12;
    const rowH = cardH + gapY;
    const screenW = 1920;
    const perRow = 10;
    const totalRows = Math.ceil(cardData.length / perRow);
    const stripW = perRow * cardW + (perRow - 1) * gapX;
    const offsetX = (screenW - stripW) / 2;

    cardData.forEach((card, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const el = document.createElement('div');
      el.className = 'scroll-card';
      const imgUrl = typeof card === 'string'
        ? `https://images.pokemontcg.io/${card.split('-')[0]}/${card.split('-')[1]}_hires.png`
        : (card.imageUrl || `https://images.pokemontcg.io/${card.setCode}/${card.number}_hires.png`);
      el.innerHTML = `<img src="${imgUrl}" alt="" onerror="this.src='https://images.pokemontcg.io/${typeof card === 'string' ? card.replace('-','/') : card.setCode + '/' + card.number}.png'">`;
      el.style.position = 'absolute';
      el.style.left = `${offsetX + col * (cardW + gapX)}px`;
      el.style.top = `${row * rowH}px`;
      el.style.width = `${cardW}px`;
      el.style.height = `${cardH}px`;
      container.appendChild(el);
    });

    const visibleRows = 2;
    const visibleH = visibleRows * rowH;
    const totalH = totalRows * rowH;
    let offset = visibleH + rowH;
    const endOffset = -(totalH);
    const totalDist = offset - endOffset;
    const durationSec = 18;
    const speed = totalDist / (durationSec * 60);

    const tick = () => {
      offset -= speed;
      container.style.transform = `translateY(${offset}px)`;
      if (offset > endOffset) {
        scrollRef.current = requestAnimationFrame(tick);
      } else {
        setTimeout(() => {
          container.innerHTML = '';
          container.style.transform = '';
          setUsername('');
          setCardCount(0);
          setScrolling(false);
        }, 1000);
      }
    };
    scrollRef.current = requestAnimationFrame(tick);
  };

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

  const rowH = 238 + 12;
  const visibleH = 2 * rowH;

  return (
    <div style={{ margin: 0, width: '100vw', height: '100vh', background: 'transparent', overflow: 'hidden', position: 'relative' }}>
      {/* Info bar above the scroll */}
      {scrolling && username && (
        <div style={{
          position: 'absolute', bottom: visibleH + 12, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, zIndex: 11,
        }}>
          <div style={{ fontSize: 30, fontWeight: 'bold', color: 'white', textShadow: '2px 2px 8px black' }}>
            {username}&apos;s Collection · {cardCount} cards
          </div>
          <div style={{ fontSize: 18, color: '#aaa', textShadow: '1px 1px 4px black' }}>
            Click the link in chat for your interactive Pokédex
          </div>
        </div>
      )}

      {/* Viewport — only render when scrolling */}
      {scrolling && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: visibleH, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: rowH * 0.7, background: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)', zIndex: 10, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: rowH * 0.7, background: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)', zIndex: 10, pointerEvents: 'none' }} />
          <div id="cardContainer" style={{ position: 'absolute', top: 0, left: 0, width: '100%' }} />
        </div>
      )}

      <style jsx global>{`
        .scroll-card { border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
        .scroll-card img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }
      `}</style>
    </div>
  );
}
