import { sendChatMessage } from './twitch';
import { getUserCards } from './pokemon-collection';
import * as fs from 'fs';
import * as path from 'path';

const CARDS_DB_DIR = path.join(process.cwd(), 'pokemon-tcg-data-master', 'cards', 'en');

// TCG card data cache per set
const cardDataCache = new Map<string, any[]>();

function loadSetCards(setCode: string): any[] {
  if (cardDataCache.has(setCode)) return cardDataCache.get(setCode)!;
  try {
    const file = path.join(CARDS_DB_DIR, `${setCode}.json`);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      cardDataCache.set(setCode, data);
      return data;
    }
  } catch {}
  return [];
}

function lookupCardStats(card: { name: string; number: string; setCode: string; imageUrl?: string }): BattleCard {
  const setCards = loadSetCards(card.setCode);
  const tcg = setCards.find((c: any) => c.number === card.number);

  const hp = parseInt(tcg?.hp || '50');
  const types: string[] = tcg?.types || ['Colorless'];
  const weaknesses: { type: string; value: string }[] = tcg?.weaknesses || [];
  const resistances: { type: string; value: string }[] = tcg?.resistances || [];

  // Build attacks from TCG data, fallback to generic
  let attacks: BattleAttack[] = [];
  if (tcg?.attacks && tcg.attacks.length > 0) {
    attacks = tcg.attacks.slice(0, 2).map((a: any) => ({
      name: a.name,
      cost: a.cost || ['Colorless'],
      damage: parseInt((a.damage || '0').replace(/[^0-9]/g, '')) || 10,
      text: a.text || ''
    }));
  }
  if (attacks.length === 0) {
    attacks = [{ name: 'Tackle', cost: ['Colorless'], damage: 10, text: '' }];
  }

  return {
    name: card.name,
    number: card.number,
    setCode: card.setCode,
    imageUrl: card.imageUrl || `https://images.pokemontcg.io/${card.setCode}/${card.number}_hires.png`,
    hp,
    maxHp: hp,
    types,
    attacks,
    weaknesses,
    resistances
  };
}

// ── Types ──

interface BattleAttack {
  name: string;
  cost: string[];
  damage: number;
  text: string;
}

interface BattleCard {
  name: string;
  number: string;
  setCode: string;
  imageUrl: string;
  hp: number;
  maxHp: number;
  types: string[];
  attacks: BattleAttack[];
  weaknesses: { type: string; value: string }[];
  resistances: { type: string; value: string }[];
}

interface BattlePlayer {
  username: string;
  cards: BattleCard[];
  activeIndex: number;
  energy: string[]; // accumulated energy types
}

interface GymBattle {
  challenger: BattlePlayer;
  gymLeader: BattlePlayer;
  currentTurn: 'challenger' | 'gymLeader';
  turnCount: number;
  expiresAt: number;
}

// Pick 3 battle-worthy Pokemon: use saved team if set, else filter Trainers/Energy and prefer rares
async function pickThree(cards: any[], username: string): Promise<BattleCard[]> {
  const { getGymTeam } = require('./gym-team');
  const team = await getGymTeam(username);
  if (team && team.length === 3) {
    const picked = team.map((id: string) => cards.find((c: any) => `${c.setCode}-${c.number}` === id)).filter(Boolean);
    if (picked.length === 3) {
      const valid = picked.every((c: any) => {
        const tcg = loadSetCards(c.setCode).find((t: any) => t.number === c.number);
        return !tcg || tcg.supertype === 'Pokémon';
      });
      if (valid) return picked.map((c: any) => lookupCardStats(c));
    }
  }
  const pokemon = cards.filter(c => {
    const tcg = loadSetCards(c.setCode).find((t: any) => t.number === c.number);
    return !tcg || tcg.supertype === 'Pokémon';
  });
  const pool = pokemon.length >= 3 ? pokemon : cards;
  const rarityOrder: Record<string, number> = { 'Rare Holo': 4, 'Rare': 3, 'Uncommon': 2, 'Promo': 2, 'Common': 1 };
  const sorted = [...pool].sort(() => Math.random() - 0.5)
    .sort((a, b) => (rarityOrder[b.rarity] || 0) - (rarityOrder[a.rarity] || 0));
  const top = sorted.slice(0, Math.max(5, 3));
  const picked = [...top].sort(() => Math.random() - 0.5).slice(0, 3);
  return picked.map(c => lookupCardStats(c));
}

// ── State (survive hot reload) ──

const g = global as any;
if (!g.__gymBattleState) g.__gymBattleState = { queue: [] as string[], battle: null as GymBattle | null };
const challengeQueue: string[] = g.__gymBattleState.queue;
let activeBattle: GymBattle | null = g.__gymBattleState.battle;

function setActiveBattle(b: GymBattle | null) {
  activeBattle = b;
  g.__gymBattleState.battle = b;
}

// Get broadcaster username
function getBroadcasterUsername(): string {
  try {
    const tokensPath = path.join(process.cwd(), 'tokens', 'twitch-tokens.json');
    if (fs.existsSync(tokensPath)) {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      if (tokens.broadcasterUsername) return tokens.broadcasterUsername;
    }
  } catch {}
  try {
    const { readUserConfigSync } = require('../lib/user-config');
    return readUserConfigSync().TWITCH_BROADCASTER_USERNAME || 'broadcaster';
  } catch {}
  return 'broadcaster';
}

// ── Queue ──

export function getQueue(): string[] {
  return [...challengeQueue];
}

export function getActiveBattle(): GymBattle | null {
  return activeBattle;
}

export async function joinQueue(username: string): Promise<void> {
  const broadcaster = getBroadcasterUsername();
  if (username.toLowerCase() === broadcaster.toLowerCase()) {
    await sendChatMessage(`@${username}, you're the gym leader — you don't queue!`, 'broadcaster');
    return;
  }

  if (activeBattle && (activeBattle.challenger.username.toLowerCase() === username.toLowerCase())) {
    await sendChatMessage(`@${username}, you're already in a battle!`, 'broadcaster');
    return;
  }

  if (challengeQueue.includes(username.toLowerCase())) {
    await sendChatMessage(`@${username}, you're already in the queue (#${challengeQueue.indexOf(username.toLowerCase()) + 1})!`, 'broadcaster');
    return;
  }

  const cards = await getUserCards(username);
  if (cards.length < 3) {
    await sendChatMessage(`@${username}, you need at least 3 cards to challenge the gym! Use !pack to get cards.`, 'broadcaster');
    return;
  }

  challengeQueue.push(username.toLowerCase());
  const pos = challengeQueue.length;
  await sendChatMessage(`@${username} joined the gym queue! Position: #${pos}`, 'broadcaster');

  const broadcast = (global as any).broadcast;
  if (typeof broadcast === 'function') {
    broadcast({ type: 'gym-queue-update', payload: { queue: [...challengeQueue], count: pos } });
  }
}

export async function startNextBattle(): Promise<void> {
  if (activeBattle) {
    await sendChatMessage('A gym battle is already in progress!', 'broadcaster');
    return;
  }

  if (challengeQueue.length === 0) {
    await sendChatMessage('No challengers in the queue!', 'broadcaster');
    return;
  }

  const challengerName = challengeQueue.shift()!;
  const broadcaster = getBroadcasterUsername();
  const isTest = challengerName === 'testchallenger';

  const challengerCards = isTest ? [] : await getUserCards(challengerName);
  const leaderCards = await getUserCards(broadcaster);

  if (!isTest && challengerCards.length < 3) {
    await sendChatMessage(`@${challengerName} no longer has enough cards. Skipping...`, 'broadcaster');
    return startNextBattle();
  }
  if (leaderCards.length < 3) {
    await sendChatMessage(`Gym leader doesn't have enough cards!`, 'broadcaster');
    challengeQueue.unshift(challengerName);
    return;
  }

  const challengerPick = isTest ? [
    lookupCardStats({ name: 'Charizard', number: '4', setCode: 'base1' }),
    lookupCardStats({ name: 'Blastoise', number: '2', setCode: 'base1' }),
    lookupCardStats({ name: 'Venusaur', number: '15', setCode: 'base1' }),
  ] : await pickThree(challengerCards, challengerName);
  const displayName = isTest ? 'TestChallenger' : challengerName;

  // Pick 3 random cards, look up full stats
  setActiveBattle({
    challenger: { username: displayName, cards: challengerPick, activeIndex: 0, energy: [] },
    gymLeader: { username: broadcaster, cards: await pickThree(leaderCards, broadcaster), activeIndex: 0, energy: [] },
    currentTurn: 'challenger',
    turnCount: 1,
    expiresAt: Date.now() + 300000
  });

  const broadcast = (global as any).broadcast;
  if (typeof broadcast === 'function') {
    broadcast({ type: 'gym-battle-start', payload: buildBattleState() });
    broadcast({ type: 'gym-queue-update', payload: { queue: [...challengeQueue], count: challengeQueue.length } });
  }

  await sendChatMessage(
    `🏅 GYM BATTLE! @${displayName} vs Gym Leader @${broadcaster}!`,
    'broadcaster'
  );
  await sendChatMessage(
    `A gym battle has begun! ${displayName} is challenging ${broadcaster}! Good luck to both trainers!`,
    'bot'
  );

  // Give first turn energy
  const activeCard = activeBattle.challenger.cards[0];
  activeBattle.challenger.energy.push(activeCard.types[0] || 'Colorless');

  await announceActiveCards();
  await sendChatMessage(
    `@${displayName}, your turn! Type !attack or !switch`,
    'broadcaster'
  );

  // Auto-play first turn if TestChallenger
  if (isTest) {
    setTimeout(() => battleAttack('TestChallenger').catch(() => {}), 2000);
  }
}

// ── Battle commands ──

export async function battleAttack(username: string): Promise<void> {
  if (!activeBattle) {
    await sendChatMessage(`@${username}, no battle in progress!`, 'broadcaster');
    return;
  }

  const isChallenger = username.toLowerCase() === activeBattle.challenger.username.toLowerCase();
  const isLeader = username.toLowerCase() === activeBattle.gymLeader.username.toLowerCase();
  if (!isChallenger && !isLeader) {
    await sendChatMessage(`@${username}, you're not in this battle!`, 'broadcaster');
    return;
  }

  const expectedTurn = activeBattle.currentTurn;
  if ((isChallenger && expectedTurn !== 'challenger') || (isLeader && expectedTurn !== 'gymLeader')) {
    await sendChatMessage(`@${username}, it's not your turn!`, 'broadcaster');
    return;
  }

  const attacker = isChallenger ? activeBattle.challenger : activeBattle.gymLeader;
  const defender = isChallenger ? activeBattle.gymLeader : activeBattle.challenger;
  const activeCard = attacker.cards[attacker.activeIndex];
  const defenderCard = defender.cards[defender.activeIndex];

  // Find best affordable attack
  const attack = findBestAttack(activeCard, attacker.energy);
  if (!attack) {
    await sendChatMessage(`@${username}, not enough energy! You have: ${attacker.energy.join(', ') || 'none'}. Try !switch or wait a turn.`, 'broadcaster');
    // Still end turn — they lose their turn
    await endTurn();
    return;
  }

  // Spend energy
  spendEnergy(attacker, attack.cost);

  // Calculate damage with weakness/resistance
  let damage = attack.damage;
  const attackerType = activeCard.types[0] || 'Colorless';
  const weak = defenderCard.weaknesses.find(w => w.type === attackerType);
  const resist = defenderCard.resistances.find(r => r.type === attackerType);
  if (weak) damage = Math.floor(damage * 2);
  if (resist) damage = Math.max(0, damage - 30);

  defenderCard.hp = Math.max(0, defenderCard.hp - damage);

  const broadcast = (global as any).broadcast;
  if (typeof broadcast === 'function') {
    broadcast({
      type: 'gym-battle-attack',
      payload: {
        attacker: attacker.username,
        defender: defender.username,
        attackName: attack.name,
        damage,
        wasWeakness: !!weak,
        wasResistance: !!resist,
        ...buildBattleState()
      }
    });
  }

  let msg = `${activeCard.name} used ${attack.name}! ${damage} damage to ${defenderCard.name}!`;
  if (weak) msg += ' Super effective!';
  if (resist) msg += ' Not very effective...';
  msg += ` (${defenderCard.hp}/${defenderCard.maxHp} HP)`;
  await sendChatMessage(msg, 'broadcaster');

  // Check faint
  if (defenderCard.hp <= 0) {
    await sendChatMessage(`${defenderCard.name} fainted!`, 'broadcaster');

    const alive = defender.cards.filter(c => c.hp > 0);
    if (alive.length === 0) {
      await endBattle(attacker.username);
      return;
    }

    // Auto-switch to next alive card
    const nextIdx = defender.cards.findIndex(c => c.hp > 0);
    defender.activeIndex = nextIdx;
    await sendChatMessage(`@${defender.username} sent out ${defender.cards[nextIdx].name}!`, 'broadcaster');
  }

  await endTurn();
}

export async function battleSwitch(username: string): Promise<void> {
  if (!activeBattle) {
    await sendChatMessage(`@${username}, no battle in progress!`, 'broadcaster');
    return;
  }

  const isChallenger = username.toLowerCase() === activeBattle.challenger.username.toLowerCase();
  const isLeader = username.toLowerCase() === activeBattle.gymLeader.username.toLowerCase();
  if (!isChallenger && !isLeader) return;

  const expectedTurn = activeBattle.currentTurn;
  if ((isChallenger && expectedTurn !== 'challenger') || (isLeader && expectedTurn !== 'gymLeader')) {
    await sendChatMessage(`@${username}, it's not your turn!`, 'broadcaster');
    return;
  }

  const player = isChallenger ? activeBattle.challenger : activeBattle.gymLeader;
  const alive = player.cards.map((c, i) => ({ c, i })).filter(x => x.c.hp > 0 && x.i !== player.activeIndex);

  if (alive.length === 0) {
    await sendChatMessage(`@${username}, no other Pokemon available!`, 'broadcaster');
    return;
  }

  // Cycle to next alive card
  const next = alive[0];
  player.activeIndex = next.i;

  const broadcast = (global as any).broadcast;
  if (typeof broadcast === 'function') {
    broadcast({ type: 'gym-battle-switch', payload: { player: player.username, ...buildBattleState() } });
  }

  await sendChatMessage(`@${username} switched to ${next.c.name}!`, 'broadcaster');
  await endTurn();
}

// ── Helpers ──

function findBestAttack(card: BattleCard, energy: string[]): BattleAttack | null {
  // Try attacks from strongest to weakest
  const sorted = [...card.attacks].sort((a, b) => b.damage - a.damage);
  for (const attack of sorted) {
    if (canAfford(attack.cost, energy)) return attack;
  }
  return null;
}

function canAfford(cost: string[], energy: string[]): boolean {
  return energy.length >= cost.length;
}

function spendEnergy(player: BattlePlayer, cost: string[]): void {
  player.energy.splice(0, cost.length);
}

async function endTurn(): Promise<void> {
  if (!activeBattle) return;

  // Reset inactivity timer every turn
  activeBattle.expiresAt = Date.now() + 300000;

  activeBattle.currentTurn = activeBattle.currentTurn === 'challenger' ? 'gymLeader' : 'challenger';
  activeBattle.turnCount++;

  // Add energy matching active card's type
  const activePlayer = activeBattle.currentTurn === 'challenger' ? activeBattle.challenger : activeBattle.gymLeader;
  const activeCard = activePlayer.cards[activePlayer.activeIndex];
  activePlayer.energy.push(activeCard.types[0] || 'Colorless');

  const broadcast = (global as any).broadcast;
  if (typeof broadcast === 'function') {
    broadcast({ type: 'gym-battle-turn', payload: buildBattleState() });
  }

  await sendChatMessage(
    `@${activePlayer.username}'s turn! ${activeCard.name} (${activeCard.hp}/${activeCard.maxHp} HP) | Energy: ${activePlayer.energy.join(', ')} | !attack or !switch`,
    'broadcaster'
  );

  // Auto-play TestChallenger turns
  if (activeBattle && activeBattle.currentTurn === 'challenger' && activeBattle.challenger.username === 'TestChallenger') {
    setTimeout(() => battleAttack('TestChallenger').catch(() => {}), 2000);
  }
}

async function announceActiveCards(): Promise<void> {
  if (!activeBattle) return;
  const c = activeBattle.challenger;
  const g = activeBattle.gymLeader;
  const cCard = c.cards[c.activeIndex];
  const gCard = g.cards[g.activeIndex];
  await sendChatMessage(
    `${c.username}: ${cCard.name} (${cCard.hp} HP) | ${g.username}: ${gCard.name} (${gCard.hp} HP)`,
    'broadcaster'
  );
}

async function endBattle(winner: string): Promise<void> {
  if (!activeBattle) return;

  const isChallenger = winner.toLowerCase() === activeBattle.challenger.username.toLowerCase();

  const broadcast = (global as any).broadcast;
  if (typeof broadcast === 'function') {
    broadcast({
      type: 'gym-battle-end',
      payload: {
        winner,
        isChallenger,
        ...buildBattleState()
      }
    });
  }

  if (isChallenger) {
    // Award gym badge
    const { awardGymBadge } = require('./user-stats');
    const badgeName = `Gym Badge: defeated ${activeBattle.gymLeader.username}`;
    await awardGymBadge(winner, badgeName);

    await sendChatMessage(
      `🏅 VICTORY! @${winner} defeated Gym Leader @${activeBattle.gymLeader.username} and earned a Gym Badge!`,
      'broadcaster'
    );
    await sendChatMessage(
      `Congratulations ${winner}! You've proven yourself as a skilled trainer!`,
      'bot'
    );
  } else {
    await sendChatMessage(
      `💪 Gym Leader @${activeBattle.gymLeader.username} defended the gym! @${activeBattle.challenger.username}, train harder!`,
      'broadcaster'
    );
    await sendChatMessage(
      `${activeBattle.challenger.username}, don't give up! Every defeat makes you stronger!`,
      'bot'
    );
  }

  setActiveBattle(null);
}

function buildBattleState() {
  if (!activeBattle) return {};
  return {
    challenger: {
      username: activeBattle.challenger.username,
      cards: activeBattle.challenger.cards,
      activeIndex: activeBattle.challenger.activeIndex,
      energy: activeBattle.challenger.energy
    },
    gymLeader: {
      username: activeBattle.gymLeader.username,
      cards: activeBattle.gymLeader.cards,
      activeIndex: activeBattle.gymLeader.activeIndex,
      energy: activeBattle.gymLeader.energy
    },
    currentTurn: activeBattle.currentTurn,
    turnCount: activeBattle.turnCount
  };
}

// Cleanup expired battles (single interval survives hot reload)
if (!g.__gymBattleInterval) {
  g.__gymBattleInterval = setInterval(() => {
    const battle = g.__gymBattleState.battle;
    if (battle && battle.expiresAt < Date.now()) {
      sendChatMessage(
        `⏰ Gym battle between @${battle.challenger.username} and @${battle.gymLeader.username} expired!`,
        'broadcaster'
      ).catch(() => {});
      g.__gymBattleState.battle = null;
      activeBattle = null;
    }
  }, 30000);
}

export async function testGymBattle(): Promise<void> {
  if (challengeQueue.includes('testchallenger')) {
    await sendChatMessage('TestChallenger is already in the queue!', 'broadcaster');
    return;
  }
  challengeQueue.push('testchallenger');
  const pos = challengeQueue.length;

  const broadcast = (global as any).broadcast;
  if (typeof broadcast === 'function') {
    broadcast({ type: 'gym-queue-update', payload: { queue: [...challengeQueue], count: pos } });
  }

  await sendChatMessage(`🧪 TestChallenger joined the gym queue! Position: #${pos} | Use !nextchallenger to start the battle.`, 'broadcaster');
}
