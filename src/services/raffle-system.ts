import { randomInt, randomUUID } from 'node:crypto';
import { readJsonFile, writeJsonFile } from './storage';

const RAFFLE_FILE = 'raffle-state.json';
const RAFFLE_CONTEXT = { tenantId: 'spacemountainlive', username: 'raffle' };

export type RaffleEntrant = { userId: string; username: string; displayName: string; tickets: number };
export type RaffleRewardRule = { rewardId: string; title: string; tickets: number };
export type RaffleRedemption = {
  redemptionId: string; userId: string; username: string; displayName: string;
  rewardId: string; rewardTitle: string; ticketCount: number; status: string;
  redeemedAt: string; updatedAt: string;
};
export type RaffleDraw = {
  id: string; cycleId: number; status: 'drawing' | 'complete'; startedAt: string; revealAt: string;
  stepMs: number; totalTickets: number; entrants: RaffleEntrant[]; eliminationOrder: string[];
  winner: RaffleEntrant; announcementClaimedAt?: string; announcedAt?: string;
};
export type RaffleState = {
  version: 1; cycleId: number; openedAt: string; rewardRules: Record<string, RaffleRewardRule>;
  redemptions: Record<string, RaffleRedemption>; draw: RaffleDraw | null;
  history: Array<{ cycleId: number; closedAt: string; totalTickets: number; entrants: number; winner?: string }>;
};

function initialState(): RaffleState {
  return { version: 1, cycleId: 1, openedAt: new Date().toISOString(), rewardRules: {}, redemptions: {}, draw: null, history: [] };
}
async function readState(): Promise<RaffleState> {
  const state = await readJsonFile<RaffleState>(RAFFLE_FILE, initialState(), RAFFLE_CONTEXT);
  return { ...initialState(), ...state, rewardRules: state?.rewardRules || {}, redemptions: state?.redemptions || {}, history: Array.isArray(state?.history) ? state.history.slice(-25) : [] };
}
async function writeState(state: RaffleState) { await writeJsonFile(RAFFLE_FILE, state, RAFFLE_CONTEXT); }

export function inferRaffleTicketQuantity(title: string): number | null {
  const normalized = String(title || '').toLowerCase().replace(/[×]/g, 'x').replace(/\s+/g, ' ').trim();
  if (!normalized.includes('raffle') || !normalized.includes('ticket')) return null;
  for (const pattern of [/(?:x\s*)(\d{1,3})\b/, /\b(\d{1,3})\s*x\b/, /\b(\d{1,3})\s+(?:raffle\s+)?tickets?\b/, /\b(\d{1,3})\s+(?:entries|entry)\b/]) {
    const value = Number(normalized.match(pattern)?.[1] || 0);
    if (Number.isFinite(value) && value > 0) return Math.min(1000, Math.floor(value));
  }
  return 1;
}
function active(entry: RaffleRedemption) { return String(entry.status || '').toLowerCase() !== 'canceled'; }
function aggregate(state: RaffleState): RaffleEntrant[] {
  const users = new Map<string, RaffleEntrant>();
  for (const entry of Object.values(state.redemptions)) {
    if (!active(entry) || entry.ticketCount <= 0) continue;
    const key = String(entry.userId || entry.username).trim().toLowerCase();
    if (!key) continue;
    const row = users.get(key) || { userId: entry.userId, username: entry.username, displayName: entry.displayName || entry.username, tickets: 0 };
    row.tickets += Math.max(0, Number(entry.ticketCount) || 0);
    if (entry.displayName) row.displayName = entry.displayName;
    if (entry.username) row.username = entry.username.toLowerCase();
    users.set(key, row);
  }
  return [...users.values()].filter((row) => row.tickets > 0).sort((a, b) => b.tickets - a.tickets || a.displayName.localeCompare(b.displayName));
}

export async function recordRaffleRedemption(input: {
  redemptionId: string; userId?: string; username: string; displayName?: string; rewardId?: string;
  rewardTitle: string; status?: string; redeemedAt?: string;
}) {
  const inferred = inferRaffleTicketQuantity(input.rewardTitle);
  if (inferred === null) return { tracked: false, added: false, ticketsAdded: 0, totalTickets: 0 };
  const state = await readState();
  const rewardId = String(input.rewardId || input.rewardTitle).trim();
  const reward = state.rewardRules[rewardId] || { rewardId, title: String(input.rewardTitle || '').trim(), tickets: inferred };
  state.rewardRules[rewardId] = reward;
  const redemptionId = String(input.redemptionId || '').trim();
  if (!redemptionId) return { tracked: false, added: false, ticketsAdded: 0, totalTickets: 0 };
  const existing = state.redemptions[redemptionId];
  const now = new Date().toISOString();
  const status = String(input.status || existing?.status || 'unfulfilled').toLowerCase();
  state.redemptions[redemptionId] = {
    redemptionId, userId: String(input.userId || existing?.userId || ''), username: String(input.username || existing?.username || '').trim().toLowerCase(),
    displayName: String(input.displayName || existing?.displayName || input.username || '').trim(), rewardId, rewardTitle: reward.title,
    ticketCount: reward.tickets, status, redeemedAt: String(input.redeemedAt || existing?.redeemedAt || now), updatedAt: now,
  };
  await writeState(state);
  const normalizedUser = String(input.username || '').toLowerCase();
  const totalTickets = aggregate(state).filter((row) => (input.userId && row.userId === input.userId) || row.username === normalizedUser).reduce((sum, row) => sum + row.tickets, 0);
  const newlyCounted = !existing && status !== 'canceled';
  return { tracked: true, added: newlyCounted, ticketsAdded: newlyCounted ? reward.tickets : 0, totalTickets, reward };
}

export async function getRaffleTicketBalance(username: string, userId?: string): Promise<number> {
  const normalized = String(username || '').trim().toLowerCase();
  return aggregate(await readState()).filter((row) => (userId && row.userId === userId) || row.username === normalized).reduce((sum, row) => sum + row.tickets, 0);
}
export async function getRaffleSummary() {
  const state = await readState();
  const entrants = aggregate(state);
  return { cycleId: state.cycleId, openedAt: state.openedAt, entrants, uniqueEntrants: entrants.length, totalTickets: entrants.reduce((sum, row) => sum + row.tickets, 0), rewardRules: Object.values(state.rewardRules).sort((a, b) => a.title.localeCompare(b.title)), draw: state.draw };
}
function shuffle<T>(source: T[]): T[] {
  const items = [...source];
  for (let i = items.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [items[i], items[j]] = [items[j], items[i]]; }
  return items;
}
export async function startRaffleDraw(): Promise<RaffleDraw> {
  const state = await readState();
  if (state.draw) return state.draw;
  const entrants = aggregate(state);
  const totalTickets = entrants.reduce((sum, row) => sum + row.tickets, 0);
  if (!entrants.length || totalTickets <= 0) throw new Error('No raffle tickets have been recorded yet.');
  let ticket = randomInt(totalTickets);
  let winner = entrants[0];
  for (const entrant of entrants) { if (ticket < entrant.tickets) { winner = entrant; break; } ticket -= entrant.tickets; }
  const eliminationOrder = shuffle(entrants.filter((row) => row.username !== winner.username).map((row) => row.username));
  const stepMs = entrants.length <= 10 ? 2200 : entrants.length <= 25 ? 1600 : entrants.length <= 60 ? 1100 : 800;
  const started = Date.now();
  const draw: RaffleDraw = {
    id: randomUUID(), cycleId: state.cycleId, status: 'drawing', startedAt: new Date(started).toISOString(),
    revealAt: new Date(started + Math.max(1, eliminationOrder.length) * stepMs + 3000).toISOString(),
    stepMs, totalTickets, entrants, eliminationOrder, winner,
  };
  state.draw = draw;
  await writeState(state);
  return draw;
}
export async function claimDueRaffleAnnouncement(now = Date.now()): Promise<RaffleDraw | null> {
  const state = await readState();
  const draw = state.draw;
  if (!draw || draw.announcedAt || draw.announcementClaimedAt || Date.parse(draw.revealAt) > now) return null;
  draw.status = 'complete'; draw.announcementClaimedAt = new Date(now).toISOString(); state.draw = draw; await writeState(state); return draw;
}
export async function markRaffleAnnounced(drawId: string, delivered: boolean) {
  const state = await readState();
  if (!state.draw || state.draw.id !== drawId) return;
  if (delivered) { state.draw.status = 'complete'; state.draw.announcedAt = new Date().toISOString(); }
  else delete state.draw.announcementClaimedAt;
  await writeState(state);
}
export async function resetRaffleCycle() {
  const state = await readState(); const entrants = aggregate(state);
  state.history.push({ cycleId: state.cycleId, closedAt: new Date().toISOString(), totalTickets: entrants.reduce((sum, row) => sum + row.tickets, 0), entrants: entrants.length, winner: state.draw?.winner?.username });
  state.history = state.history.slice(-25); state.cycleId += 1; state.openedAt = new Date().toISOString(); state.redemptions = {}; state.draw = null; await writeState(state);
  return { cycleId: state.cycleId };
}
