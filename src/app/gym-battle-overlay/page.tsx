'use client';

import { useEffect, useState } from 'react';
import { getBrowserWebSocketUrl } from '@/lib/ws-config';

interface BattleCard {
  name: string;
  number: string;
  setCode: string;
  imageUrl: string;
  hp: number;
  maxHp: number;
  types: string[];
  attacks: { name: string; cost: string[]; damage: number; text: string }[];
  weaknesses: { type: string; value: string }[];
  resistances: { type: string; value: string }[];
}

interface BattlePlayer {
  username: string;
  cards: BattleCard[];
  activeIndex: number;
  energy: string[];
}

interface BattleState {
  challenger: BattlePlayer;
  gymLeader: BattlePlayer;
  currentTurn: 'challenger' | 'gymLeader';
  turnCount: number;
}

const TYPE_COLORS: Record<string, string> = {
  Fire: '#F08030', Water: '#6890F0', Grass: '#78C850', Lightning: '#F8D030',
  Psychic: '#F85888', Fighting: '#C03028', Darkness: '#705848', Metal: '#B8B8D0',
  Fairy: '#EE99AC', Dragon: '#7038F8', Colorless: '#A8A878',
};

function typeColor(type: string): string {
  return TYPE_COLORS[type] || '#A8A878';
}

export default function GymBattleOverlay() {
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [visible, setVisible] = useState(false);
  const [lastAttack, setLastAttack] = useState<{ attackName: string; damage: number; wasWeakness: boolean; wasResistance: boolean } | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      try {
        ws = new WebSocket(getBrowserWebSocketUrl());
        ws.onopen = () => console.log('[Gym Overlay] Connected');
        ws.onclose = () => { reconnectTimeout = setTimeout(connect, 3000); };
        ws.onerror = () => {};
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'gym-queue-update') {
              setQueue(data.payload.queue || []);
            } else if (data.type === 'gym-battle-start') {
              setBattle(data.payload);
              setVisible(true);
              setWinner(null);
              setLastAttack(null);
            } else if (data.type === 'gym-battle-attack') {
              const { attackName, damage, wasWeakness, wasResistance, ...state } = data.payload;
              setBattle(state);
              setLastAttack({ attackName, damage, wasWeakness, wasResistance });
              setTimeout(() => setLastAttack(null), 2000);
            } else if (data.type === 'gym-battle-turn') {
              setBattle(data.payload);
            } else if (data.type === 'gym-battle-switch') {
              setBattle(data.payload);
            } else if (data.type === 'gym-battle-end') {
              const { winner: w, ...state } = data.payload;
              setBattle(state);
              setWinner(w);
              setTimeout(() => { setVisible(false); setBattle(null); setWinner(null); }, 12000);
            }
          } catch {}
        };
      } catch {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();

    // Fetch current queue on mount so we don't miss events
    fetch('/api/pokemon/gym').then(r => r.json()).then(d => {
      if (d.queue?.length) setQueue(d.queue);
    }).catch(() => {});

    return () => { clearTimeout(reconnectTimeout); ws?.close(); };
  }, []);

  if (!visible && queue.length === 0) return null;

  // Show just the queue indicator when no battle is active
  if (!visible || !battle) {
    if (queue.length === 0) return null;
    return (
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', bottom: 24, right: 24,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          background: 'rgba(0,0,0,0.7)', borderRadius: 16, padding: '14px 24px',
          pointerEvents: 'auto', border: '2px solid rgba(255,215,0,0.3)',
        }}>
          <span style={{ color: '#ffd700', fontSize: 22, fontWeight: 'bold' }}>⚔️ Challengers</span>
          <div style={{ display: 'flex', gap: 18 }}>
            {queue.slice(0, 10).map((user, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width={48} height={48}>
                  <circle cx="12" cy="12" r="11" fill="#e53e3e" stroke="#222" strokeWidth="1.5" />
                  <rect x="0" y="11" width="24" height="2" fill="#222" />
                  <circle cx="12" cy="12" r="4" fill="white" stroke="#222" strokeWidth="1.5" />
                  <circle cx="12" cy="12" r="2" fill="#222" />
                </svg>
                <span style={{ color: '#eee', fontSize: 14, fontWeight: 600, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>{user}</span>
              </div>
            ))}
          </div>
          {queue.length > 10 && (
            <span style={{ color: '#aaa', fontSize: 14 }}>+{queue.length - 10} more</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <div style={{ fontSize: '42px', fontWeight: 'bold', color: '#FFD700', marginBottom: '20px', textShadow: '2px 2px 8px black' }}>
        🏅 GYM BATTLE — Turn {battle.turnCount}
      </div>

      {/* Arena */}
      <div style={{ display: 'flex', gap: '60px', alignItems: 'flex-start' }}>
        <PlayerSide player={battle.challenger} label="Challenger" color="#4A90D9" isActive={battle.currentTurn === 'challenger'} lastAttack={battle.currentTurn === 'gymLeader' ? lastAttack : null} />
        <div style={{ fontSize: '48px', color: '#FFD700', alignSelf: 'center', textShadow: '0 0 15px rgba(255,215,0,0.6)' }}>VS</div>
        <PlayerSide player={battle.gymLeader} label="Gym Leader" color="#D94A4A" isActive={battle.currentTurn === 'gymLeader'} lastAttack={battle.currentTurn === 'challenger' ? lastAttack : null} />
      </div>

      {/* Attack flash */}
      {lastAttack && (
        <div style={{
          position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)',
          fontSize: '36px', fontWeight: 'bold', color: lastAttack.wasWeakness ? '#FF4444' : '#fff',
          textShadow: '2px 2px 8px black', animation: 'popFade 2s forwards'
        }}>
          {lastAttack.attackName}! -{lastAttack.damage}
          {lastAttack.wasWeakness && ' 💥 Super Effective!'}
          {lastAttack.wasResistance && ' 🛡️ Resisted'}
        </div>
      )}

      {/* Victory overlay */}
      {winner && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.9)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.5s ease-out'
        }}>
          <div style={{ fontSize: '72px', fontWeight: 'bold', color: '#FFD700', textShadow: '0 0 30px rgba(255,215,0,0.8)', marginBottom: '20px' }}>
            🏆 VICTORY! 🏆
          </div>
          <div style={{ fontSize: '48px', color: 'white' }}>{winner} wins!</div>
        </div>
      )}

      {queue.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 24, right: 24,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          background: 'rgba(0,0,0,0.7)', borderRadius: 16, padding: '14px 24px',
          border: '2px solid rgba(255,215,0,0.3)',
        }}>
          <span style={{ color: '#ffd700', fontSize: 22, fontWeight: 'bold' }}>⚔️ Challengers</span>
          <div style={{ display: 'flex', gap: 18 }}>
            {queue.slice(0, 10).map((user, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width={48} height={48}>
                  <circle cx="12" cy="12" r="11" fill="#e53e3e" stroke="#222" strokeWidth="1.5" />
                  <rect x="0" y="11" width="24" height="2" fill="#222" />
                  <circle cx="12" cy="12" r="4" fill="white" stroke="#222" strokeWidth="1.5" />
                  <circle cx="12" cy="12" r="2" fill="#222" />
                </svg>
                <span style={{ color: '#eee', fontSize: 14, fontWeight: 600, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>{user}</span>
              </div>
            ))}
          </div>
          {queue.length > 10 && (
            <span style={{ color: '#aaa', fontSize: 14 }}>+{queue.length - 10} more</span>
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes popFade { 0% { opacity: 1; transform: translateX(-50%) scale(1.2); } 100% { opacity: 0; transform: translateX(-50%) translateY(-40px) scale(1); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}

function PlayerSide({ player, label, color, isActive, lastAttack }: {
  player: BattlePlayer; label: string; color: string; isActive: boolean;
  lastAttack: { attackName: string; damage: number; wasWeakness: boolean; wasResistance: boolean } | null;
}) {
  const active = player.cards[player.activeIndex];
  if (!active) return null;

  const hpPct = Math.max(0, (active.hp / active.maxHp) * 100);
  const hpColor = hpPct > 50 ? '#4CAF50' : hpPct > 25 ? '#FF9800' : '#F44336';

  return (
    <div style={{ width: '420px', textAlign: 'center' }}>
      {/* Player name */}
      <div style={{
        fontSize: '24px', fontWeight: 'bold', color: isActive ? '#FFD700' : '#aaa',
        marginBottom: '8px', textShadow: '1px 1px 4px black',
        border: isActive ? '2px solid #FFD700' : '2px solid transparent',
        borderRadius: '8px', padding: '4px 12px', display: 'inline-block'
      }}>
        {isActive ? '▶ ' : ''}{label}: {player.username}
      </div>

      {/* Active card */}
      <div style={{
        position: 'relative', margin: '0 auto', width: '240px', height: '336px',
        borderRadius: '12px', overflow: 'hidden',
        boxShadow: `0 0 ${isActive ? '20px' : '8px'} ${color}`,
        border: `3px solid ${color}`,
        animation: lastAttack ? 'shake 0.3s' : 'none'
      }}>
        <img src={active.imageUrl} alt={active.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>

      {/* HP bar */}
      <div style={{ margin: '10px auto', width: '240px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'white', fontSize: '14px', marginBottom: '4px' }}>
          <span>{active.name}</span>
          <span>{active.hp}/{active.maxHp} HP</span>
        </div>
        <div style={{ width: '100%', height: '12px', background: '#333', borderRadius: '6px', overflow: 'hidden' }}>
          <div style={{ width: `${hpPct}%`, height: '100%', background: hpColor, borderRadius: '6px', transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Energy */}
      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
        {player.energy.map((e, i) => (
          <div key={i} style={{
            width: '20px', height: '20px', borderRadius: '50%',
            background: typeColor(e), border: '2px solid white',
            boxShadow: `0 0 6px ${typeColor(e)}`
          }} title={e} />
        ))}
      </div>

      {/* Attacks */}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {active.attacks.map((atk, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,0.1)', borderRadius: '6px', padding: '4px 10px',
            color: '#ddd', fontSize: '12px', border: '1px solid rgba(255,255,255,0.2)'
          }}>
            {atk.name} ({atk.cost.length}⚡) {atk.damage}dmg
          </div>
        ))}
      </div>

      {/* Bench */}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '10px' }}>
        {player.cards.map((card, i) => (
          <div key={i} style={{
            width: '60px', height: '84px', borderRadius: '6px', overflow: 'hidden',
            border: i === player.activeIndex ? '2px solid #FFD700' : card.hp > 0 ? '2px solid #555' : '2px solid #F44336',
            opacity: card.hp > 0 ? 1 : 0.4
          }}>
            <img src={card.imageUrl} alt={card.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        ))}
      </div>

      <style jsx>{`
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
      `}</style>
    </div>
  );
}
