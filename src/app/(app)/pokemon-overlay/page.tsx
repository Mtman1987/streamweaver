'use client';

import { useEffect, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

interface Card {
  number: string;
  name: string;
  rarity: string;
  setCode: string;
}

export default function PokemonPackOverlay() {
  const [pack, setPack] = useState<Card[]>([]);
  const [setName, setSetName] = useState('');
  const [username, setUsername] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(getBrowserWebSocketUrl());
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pokemon-pack-opened') {
          const { pack, setName, username } = data.payload;
          setPack(pack);
          setSetName(setName);
          setUsername(username);
          setVisible(true);
          
          setTimeout(() => {
            setVisible(false);
            setTimeout(() => {
              setPack([]);
              setSetName('');
              setUsername('');
            }, 500);
          }, 15000);
        }
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };
    
    return () => ws.close();
  }, []);

  if (!visible || pack.length === 0) return null;

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
      <h1 className="text-5xl font-bold text-white mb-8 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
        {username} opened a {setName} pack!
      </h1>
      
      <div className="grid grid-cols-6 gap-4 max-w-7xl">
        {pack.map((card, index) => (
          <div
            key={index}
            className="bg-white rounded-xl shadow-2xl p-3 transform transition-all duration-300 hover:scale-105"
            style={{
              animation: `cardFlip 0.6s ${index * 0.1}s forwards`,
              transformStyle: 'preserve-3d',
              opacity: 0,
            }}
          >
            <div className="aspect-[2/3] bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center mb-2">
              <img
                src={`/pokemon-cards/${card.name.toLowerCase().replace(/\s+/g, '_')}_${card.number}_${card.setCode}.jpg`}
                alt={card.name}
                className="w-full h-full object-cover rounded-lg"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling!.classList.remove('hidden');
                }}
              />
              <div className="hidden text-center p-4">
                <div className="text-2xl font-bold text-gray-700">{card.name}</div>
                <div className="text-sm text-gray-500">#{card.number}</div>
              </div>
            </div>
            <div className="text-center">
              <div className="font-bold text-sm truncate">{card.name}</div>
              <div className={`text-xs ${
                card.rarity.includes('Holo') ? 'text-yellow-500 font-bold' :
                card.rarity.includes('Rare') ? 'text-purple-500 font-bold' :
                card.rarity.includes('Uncommon') ? 'text-blue-500' :
                'text-gray-500'
              }`}>
                {card.rarity}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <style jsx>{`
        @keyframes cardFlip {
          from {
            transform: scale(0) rotateY(180deg);
            opacity: 0;
          }
          to {
            transform: scale(1) rotateY(0deg);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
