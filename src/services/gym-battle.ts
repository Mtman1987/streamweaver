import { sendChatMessage } from './twitch';
import { getUserCards } from './pokemon-collection';
import * as fs from 'fs';
import * as path from 'path';

const CARDS_DB_DIR = path.join(process.cwd(), 'pokemon-tcg-data-master', 'cards', 'en');

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
  let attacks: BattleAttack[] = [];
  if (tcg?.attacks && tcg.attacks.length > 0) {
    attacks = tcg.attacks.slice(0, 2).map((a: any) => ({
      name: a.name, cost: a.cost || ['Colorless'],
      damage: parseInt((a.damage || '0').replace(/[^0-9]/g, '')) || 10, text: a.text || ''
    }));
  }
  if (attacks.length === 0) attacks = [{ name: 'Tackle', cost: ['Colorless'], damage: 10, text: '' }];
  return { name: card.name, number: card.number, setCode: card.setCode,
    imageUrl: card.imageUrl || `https://images.pokemontcg.io/${card.setCode}/${card.number}_hires.png`,
    hp, maxHp: hp, types, attacks, weaknesses, resistances };
}

// ── Types ──

interface BattleAttack { name: string; cost: string[]; damage: number; text: string; }
interface BattleCard { name: string; number: string; setCode: string; imageUrl: string; hp: number; maxHp: number; types: string[]; attacks: BattleAttack[]; weaknesses: { type: string; value: string }[]; resistances: { type: string; value: string }[]; }
interface BattlePlayer { username: string; cards: BattleCard[]; activeIndex: number; energy: string[]; }
interface GymBattle { challenger: BattlePlayer; gymLeader: BattlePlayer; currentTurn: 'challenger' | 'gymLeader'; turnCount: number; expiresAt: number; tenantId?: string; }

async function pickThree(cards: any[], username: string): Promise<BattleCard[]> {
  const { getGymTeam } = require('./gym-team');
  const team = await getGymTeam(username);
  if (team && team.length === 3) {
    const picked = team.map((id: string) => cards.find((c: any) => `${c.setCode}-${c.number}` === id)).filter(Boolean);
    if (picked.length === 3) {
      const valid = picked.every((c: any) => { const tcg = loadSetCards(c.setCode).find((t: any) => t.number === c.number); return !tcg || tcg.supertype === 'Pokémon'; });
      if (valid) return picked.map((c: any) => lookupCardStats(c));
    }
  }
  const pokemon = cards.filter(c => { const tcg = loadSetCards(c.setCode).find((t: any) => t.number === c.number); return !tcg || tcg.supertype === 'Pokémon'; });
  const pool = pokemon.length >= 3 ? pokemon : cards;
  const rarityOrder: Record<string, number> = { 'Rare Holo': 4, 'Rare': 3, 'Uncommon': 2, 'Promo': 2, 'Common': 1 };
  const sorted = [...pool].sort(() => Math.random() - 0.5).sort((a, b) => (rarityOrder[b.rarity] || 0) - (rarityOrder[a.rarity] || 0));
  const top = sorted.slice(0, Math.max(5, 3));
  return [...top].sort(() => Math.random() - 0.5).slice(0, 3).map(c => lookupCardStats(c));
}

// ── Per-tenant state ──

const g = global as any;
if (!g.__gymBattleStates) g.__gymBattleStates = new Map<string, { queue: string[]; battle: GymBattle | null }>();
const states: Map<string, { queue: string[]; battle: GymBattle | null }> = g.__gymBattleStates;

function getState(tenantId?: string) {
  const key = tenantId || 'global';
  if (!states.has(key)) states.set(key, { queue: [], battle: null });
  return states.get(key)!;
}

function getBroadcasterUsername(tenantId?: string): string {
  tenantId = normalizeTenantId(tenantId);
  if (tenantId) {
    try {
      const tenantsDir = path.join(process.env.PERSIST_ROOT || path.join(process.cwd(), 'data', 'runtime'), 'tenants');
      const tokensPath = path.join(tenantsDir, tenantId, 'tokens', 'twitch-tokens.json');
      if (fs.existsSync(tokensPath)) {
        const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
        if (tokens.broadcasterUsername) return tokens.broadcasterUsername;
      }
    } catch {}
  }
  try {
    const tenantsDir = path.join(process.env.PERSIST_ROOT || path.join(process.cwd(), 'data', 'runtime'), 'tenants');
    if (fs.existsSync(tenantsDir)) {
      for (const tid of fs.readdirSync(tenantsDir)) {
        const tokensPath = path.join(tenantsDir, tid, 'tokens', 'twitch-tokens.json');
        if (fs.existsSync(tokensPath)) {
          const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
          if (tokens.broadcasterUsername) return tokens.broadcasterUsername;
        }
      }
    }
  } catch {}
  return 'broadcaster';
}

function bc(msg: object, tenantId?: string) {
  tenantId = normalizeTenantId(tenantId);
  if (typeof (global as any).broadcast === 'function') (global as any).broadcast(msg, tenantId);
}

function normalizeTenantId(tenantId?: string): string | undefined {
  if (tenantId?.startsWith('__kick_silent__:')) return tenantId.slice('__kick_silent__:'.length);
  return tenantId;
}

function reply(msg: string, as: 'bot' | 'broadcaster' = 'broadcaster', tenantId?: string) {
  return sendChatMessage(msg, as, undefined, tenantId);
}

// ── Public API ──

export function getQueue(tenantId?: string): string[] { return [...getState(tenantId).queue]; }
export function getActiveBattle(tenantId?: string): GymBattle | null { return getState(tenantId).battle; }

export async function joinQueue(username: string, tenantId?: string): Promise<void> {
  const st = getState(tenantId);
  const broadcaster = getBroadcasterUsername(tenantId);
  if (username.toLowerCase() === broadcaster.toLowerCase()) { await reply(`@${username}, you're the gym leader — you don't queue!`, 'broadcaster', tenantId); return; }
  if (st.battle && st.battle.challenger.username.toLowerCase() === username.toLowerCase()) { await reply(`@${username}, you're already in a battle!`, 'broadcaster', tenantId); return; }
  if (st.queue.includes(username.toLowerCase())) { await reply(`@${username}, you're already in the queue (#${st.queue.indexOf(username.toLowerCase()) + 1})!`, 'broadcaster', tenantId); return; }
  const cards = await getUserCards(username);
  if (cards.length < 3) { await reply(`@${username}, you need at least 3 cards to challenge the gym! Use !pack to get cards.`, 'broadcaster', tenantId); return; }
  st.queue.push(username.toLowerCase());
  const pos = st.queue.length;
  await reply(`@${username} joined the gym queue! Position: #${pos}`, 'broadcaster', tenantId);
  bc({ type: 'gym-queue-update', payload: { queue: [...st.queue], count: pos } }, tenantId);
}

export async function skipBattle(tenantId?: string): Promise<void> {
  const st = getState(tenantId);
  if (!st.battle) { await reply('No battle to skip!', 'broadcaster', tenantId); return; }
  const skipped = st.battle.challenger.username;
  bc({ type: 'gym-battle-end', payload: { winner: 'none', skipped: true, ...buildBattleState(tenantId) } }, tenantId);
  await reply(`⏭️ Battle with @${skipped} was skipped.`, 'broadcaster', tenantId);
  st.battle = null;
}

export async function startNextBattle(tenantId?: string): Promise<void> {
  const st = getState(tenantId);
  if (st.battle) {
    // Force-end current battle and start next
    const skipped = st.battle.challenger.username;
    bc({ type: 'gym-battle-end', payload: { winner: 'none', skipped: true, ...buildBattleState(tenantId) } }, tenantId);
    await reply(`⏭️ Battle with @${skipped} skipped. Starting next...`, 'broadcaster', tenantId);
    st.battle = null;
  }
  if (st.queue.length === 0) { await reply('No challengers in the queue!', 'broadcaster', tenantId); return; }

  const challengerName = st.queue.shift()!;
  const broadcaster = getBroadcasterUsername(tenantId);
  const isTest = challengerName === 'testchallenger';
  const challengerCards = isTest ? [] : await getUserCards(challengerName);
  const leaderCards = await getUserCards(broadcaster);

  if (!isTest && challengerCards.length < 3) { await reply(`@${challengerName} no longer has enough cards. Skipping...`, 'broadcaster', tenantId); return startNextBattle(tenantId); }
  if (leaderCards.length < 3) { await reply(`Gym leader doesn't have enough cards!`, 'broadcaster', tenantId); st.queue.unshift(challengerName); return; }

  const challengerPick = isTest ? [
    lookupCardStats({ name: 'Charizard', number: '4', setCode: 'base1' }),
    lookupCardStats({ name: 'Blastoise', number: '2', setCode: 'base1' }),
    lookupCardStats({ name: 'Venusaur', number: '15', setCode: 'base1' }),
  ] : await pickThree(challengerCards, challengerName);
  const displayName = isTest ? 'TestChallenger' : challengerName;

  st.battle = {
    challenger: { username: displayName, cards: challengerPick, activeIndex: 0, energy: [] },
    gymLeader: { username: broadcaster, cards: await pickThree(leaderCards, broadcaster), activeIndex: 0, energy: [] },
    currentTurn: 'challenger', turnCount: 1, expiresAt: Date.now() + 120000, tenantId
  };

  bc({ type: 'gym-battle-start', payload: buildBattleState(tenantId) }, tenantId);
  bc({ type: 'gym-queue-update', payload: { queue: [...st.queue], count: st.queue.length } }, tenantId);
  await reply(`🏅 GYM BATTLE! @${displayName} vs Gym Leader @${broadcaster}!`, 'broadcaster', tenantId);
  await reply(`A gym battle has begun! ${displayName} is challenging ${broadcaster}! Good luck to both trainers!`, 'bot', tenantId);
  await announceActiveCards(tenantId);
  await reply(`@${displayName}, your turn! Type !attack or !switch`, 'broadcaster', tenantId);
  if (isTest) setTimeout(() => battleAttack('TestChallenger', tenantId).catch(() => {}), 2000);
}

export async function battleAttack(username: string, tenantId?: string): Promise<void> {
  const st = getState(tenantId);
  if (!st.battle) { await reply(`@${username}, no battle in progress!`, 'broadcaster', tenantId); return; }
  const battle = st.battle;
  const isChallenger = username.toLowerCase() === battle.challenger.username.toLowerCase();
  const isLeader = username.toLowerCase() === battle.gymLeader.username.toLowerCase();
  if (!isChallenger && !isLeader) { await reply(`@${username}, you're not in this battle!`, 'broadcaster', tenantId); return; }
  if ((isChallenger && battle.currentTurn !== 'challenger') || (isLeader && battle.currentTurn !== 'gymLeader')) { await reply(`@${username}, it's not your turn!`, 'broadcaster', tenantId); return; }

  const attacker = isChallenger ? battle.challenger : battle.gymLeader;
  const defender = isChallenger ? battle.gymLeader : battle.challenger;
  const activeCard = attacker.cards[attacker.activeIndex];
  const defenderCard = defender.cards[defender.activeIndex];
  const attack = findBestAttack(activeCard, attacker.energy);
  if (!attack) { await reply(`@${username}, not enough energy! You have: ${attacker.energy.join(', ') || 'none'}. Try !switch or wait a turn.`, 'broadcaster', tenantId); await endTurn(tenantId); return; }

  spendEnergy(attacker, attack.cost);
  let damage = attack.damage;
  const attackerType = activeCard.types[0] || 'Colorless';
  const weak = defenderCard.weaknesses.find(w => w.type === attackerType);
  const resist = defenderCard.resistances.find(r => r.type === attackerType);
  if (weak) damage = Math.floor(damage * 2);
  if (resist) damage = Math.max(0, damage - 30);
  defenderCard.hp = Math.max(0, defenderCard.hp - damage);

  bc({ type: 'gym-battle-attack', payload: { attacker: attacker.username, defender: defender.username, attackName: attack.name, damage, wasWeakness: !!weak, wasResistance: !!resist, ...buildBattleState(tenantId) } }, tenantId);

  let msg = `${activeCard.name} used ${attack.name}! ${damage} damage to ${defenderCard.name}!`;
  if (weak) msg += ' Super effective!';
  if (resist) msg += ' Not very effective...';
  msg += ` (${defenderCard.hp}/${defenderCard.maxHp} HP)`;
  await reply(msg, 'broadcaster', tenantId);

  if (defenderCard.hp <= 0) {
    await reply(`${defenderCard.name} fainted!`, 'broadcaster', tenantId);
    const alive = defender.cards.filter(c => c.hp > 0);
    if (alive.length === 0) { await endBattle(attacker.username, tenantId); return; }
    const nextIdx = defender.cards.findIndex(c => c.hp > 0);
    defender.activeIndex = nextIdx;
    await reply(`@${defender.username} sent out ${defender.cards[nextIdx].name}!`, 'broadcaster', tenantId);
  }
  await endTurn(tenantId);
}

export async function battleSwitch(username: string, tenantId?: string): Promise<void> {
  const st = getState(tenantId);
  if (!st.battle) { await reply(`@${username}, no battle in progress!`, 'broadcaster', tenantId); return; }
  const battle = st.battle;
  const isChallenger = username.toLowerCase() === battle.challenger.username.toLowerCase();
  const isLeader = username.toLowerCase() === battle.gymLeader.username.toLowerCase();
  if (!isChallenger && !isLeader) return;
  if ((isChallenger && battle.currentTurn !== 'challenger') || (isLeader && battle.currentTurn !== 'gymLeader')) { await reply(`@${username}, it's not your turn!`, 'broadcaster', tenantId); return; }

  const player = isChallenger ? battle.challenger : battle.gymLeader;
  const alive = player.cards.map((c, i) => ({ c, i })).filter(x => x.c.hp > 0 && x.i !== player.activeIndex);
  if (alive.length === 0) { await reply(`@${username}, no other Pokemon available!`, 'broadcaster', tenantId); return; }
  player.activeIndex = alive[0].i;
  bc({ type: 'gym-battle-switch', payload: { player: player.username, ...buildBattleState(tenantId) } }, tenantId);
  await reply(`@${username} switched to ${alive[0].c.name}!`, 'broadcaster', tenantId);
  await endTurn(tenantId);
}

// ── Helpers ──

function findBestAttack(card: BattleCard, energy: string[]): BattleAttack | null {
  for (const attack of [...card.attacks].sort((a, b) => b.damage - a.damage)) {
    if (energy.length >= attack.cost.length) return attack;
  }
  return null;
}

function spendEnergy(player: BattlePlayer, cost: string[]): void { player.energy.splice(0, cost.length); }

async function endTurn(tenantId?: string): Promise<void> {
  const st = getState(tenantId);
  if (!st.battle) return;
  st.battle.expiresAt = Date.now() + 120000;
  st.battle.currentTurn = st.battle.currentTurn === 'challenger' ? 'gymLeader' : 'challenger';
  st.battle.turnCount++;
  const activePlayer = st.battle.currentTurn === 'challenger' ? st.battle.challenger : st.battle.gymLeader;
  const activeCard = activePlayer.cards[activePlayer.activeIndex];
  activePlayer.energy.push(activeCard.types[0] || 'Colorless');
  bc({ type: 'gym-battle-turn', payload: buildBattleState(tenantId) }, tenantId);
  await reply(`@${activePlayer.username}'s turn! ${activeCard.name} (${activeCard.hp}/${activeCard.maxHp} HP) | Energy: ${activePlayer.energy.join(', ')} | !attack or !switch`, 'broadcaster', tenantId);
  if (st.battle && st.battle.currentTurn === 'challenger' && st.battle.challenger.username === 'TestChallenger') {
    setTimeout(() => battleAttack('TestChallenger', tenantId).catch(() => {}), 2000);
  }
}

async function announceActiveCards(tenantId?: string): Promise<void> {
  const st = getState(tenantId);
  if (!st.battle) return;
  const c = st.battle.challenger, gl = st.battle.gymLeader;
  await reply(`${c.username}: ${c.cards[c.activeIndex].name} (${c.cards[c.activeIndex].hp} HP) | ${gl.username}: ${gl.cards[gl.activeIndex].name} (${gl.cards[gl.activeIndex].hp} HP)`, 'broadcaster', tenantId);
}

async function endBattle(winner: string, tenantId?: string): Promise<void> {
  const st = getState(tenantId);
  if (!st.battle) return;
  const isChallenger = winner.toLowerCase() === st.battle.challenger.username.toLowerCase();
  bc({ type: 'gym-battle-end', payload: { winner, isChallenger, ...buildBattleState(tenantId) } }, tenantId);
  if (isChallenger) {
    const { awardGymBadge } = require('./user-stats');
    if (!tenantId) throw new Error('Gym badge award requires tenant context');
    await awardGymBadge(winner, `Gym Badge: defeated ${st.battle.gymLeader.username}`, { tenantId, username: '' });
    await reply(`🏅 VICTORY! @${winner} defeated Gym Leader @${st.battle.gymLeader.username} and earned a Gym Badge!`, 'broadcaster', tenantId);
    await reply(`Congratulations ${winner}! You've proven yourself as a skilled trainer!`, 'bot', tenantId);
  } else {
    await reply(`💪 Gym Leader @${st.battle.gymLeader.username} defended the gym! @${st.battle.challenger.username}, train harder!`, 'broadcaster', tenantId);
    await reply(`${st.battle.challenger.username}, don't give up! Every defeat makes you stronger!`, 'bot', tenantId);
  }
  st.battle = null;
}

function buildBattleState(tenantId?: string) {
  const st = getState(tenantId);
  if (!st.battle) return {};
  const b = st.battle;
  return {
    challenger: { username: b.challenger.username, cards: b.challenger.cards, activeIndex: b.challenger.activeIndex, energy: b.challenger.energy },
    gymLeader: { username: b.gymLeader.username, cards: b.gymLeader.cards, activeIndex: b.gymLeader.activeIndex, energy: b.gymLeader.energy },
    currentTurn: b.currentTurn, turnCount: b.turnCount
  };
}

// Cleanup expired battles (checks every 15s)
if (!g.__gymBattleInterval) {
  g.__gymBattleInterval = setInterval(() => {
    for (const [key, st] of states.entries()) {
      if (st.battle && st.battle.expiresAt < Date.now()) {
        const tid = st.battle.tenantId;
        const challenger = st.battle.challenger.username;
        const leader = st.battle.gymLeader.username;
        const state = buildBattleState(tid);
        st.battle = null;
        bc({ type: 'gym-battle-end', payload: { winner: 'none', expired: true, ...state } }, tid);
        sendChatMessage(`⏰ Gym battle between @${challenger} and @${leader} timed out! Use !nextchallenger to start the next battle.`, 'broadcaster', undefined, tid).catch(() => {});
      }
    }
  }, 15000);
}

export async function testGymBattle(tenantId?: string): Promise<void> {
  const st = getState(tenantId);
  if (st.queue.includes('testchallenger')) { await reply('TestChallenger is already in the queue!', 'broadcaster', tenantId); return; }
  st.queue.push('testchallenger');
  const pos = st.queue.length;
  bc({ type: 'gym-queue-update', payload: { queue: [...st.queue], count: pos } }, tenantId);
  await reply(`🧪 TestChallenger joined the gym queue! Position: #${pos} | Use !nextchallenger to start the battle.`, 'broadcaster', tenantId);
}
