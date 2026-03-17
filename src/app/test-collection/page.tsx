'use client';
import { useEffect, useRef, useState } from 'react';

export default function TestCollectionPage() {
  const scrollRef = useRef<number>(0);
  const [status, setStatus] = useState('Loading...');
  const [username, setUsername] = useState('');
  const [cardCount, setCardCount] = useState(0);
  const [scrolling, setScrolling] = useState(false);

  const runAnimation = (cardData: any[], user: string) => {
    const container = document.getElementById('cardContainer');
    if (!container) return;
    container.innerHTML = '';
    cancelAnimationFrame(scrollRef.current);

    setUsername(user);
    setCardCount(cardData.length);
    setScrolling(true);

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

    cardData.forEach((card: any, i: number) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const el = document.createElement('div');
      el.className = 'scroll-card';
      const imgUrl = card.imageUrl || `https://images.pokemontcg.io/${card.setCode}/${card.number}_hires.png`;
      el.innerHTML = `<img src="${imgUrl}" alt="${card.name}" />`;
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
    const speed = 0.8;

    setStatus(`${cardData.length} cards · ${totalRows} rows · speed ${speed}px/f`);

    const tick = () => {
      offset -= speed;
      container.style.transform = `translateY(${offset}px)`;
      if (offset > endOffset) {
        scrollRef.current = requestAnimationFrame(tick);
      } else {
        setTimeout(() => {
          setScrolling(false);
          setUsername('');
          setCardCount(0);
          // Loop for testing
          setTimeout(() => runAnimation(cardData, user), 1000);
        }, 1000);
      }
    };
    scrollRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    fetch('/api/pokemon/collection?user=mtman1987')
      .then(r => r.json())
      .then(data => {
        const cards = data.cards || data.collection?.cards || [];
        if (cards.length) {
          runAnimation(cards, 'mtman1987');
        } else {
          useDummy();
        }
      })
      .catch(() => useDummy());

    function useDummy() {
      setStatus('Using dummy data');
      const dummy = Array.from({ length: 180 }, (_, i) => ({
        name: `Card ${i}`, number: `${(i % 102) + 1}`, setCode: 'base1',
        imageUrl: `https://images.pokemontcg.io/base1/${(i % 102) + 1}_hires.png`,
      }));
      runAnimation(dummy, 'mtman1987');
    }

    return () => cancelAnimationFrame(scrollRef.current);
  }, []);

  const rowH = 238 + 12;
  const visibleH = 2 * rowH;

  return (
    <div style={{ margin: 0, width: '100vw', height: '100vh', background: '#111', overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 10, left: 10, color: '#666', fontSize: 14, zIndex: 20 }}>{status}</div>

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

      <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: visibleH, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: rowH * 0.7, background: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)', zIndex: 10, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: rowH * 0.7, background: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)', zIndex: 10, pointerEvents: 'none' }} />
        <div id="cardContainer" style={{ position: 'absolute', top: 0, left: 0, width: '100%' }} />
      </div>

      <style jsx global>{`
        .scroll-card { border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
        .scroll-card img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }
      `}</style>
    </div>
  );
}
