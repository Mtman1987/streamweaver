import { randomInt, randomUUID } from 'node:crypto';
import { readJsonFile, writeJsonFile } from './storage';
import { ensureValidToken, getStoredTokens } from '@/lib/token-utils.server';

export const RAFFLE_IDS = ['merch', 'giftcard', 'general'] as const;
export type RaffleId = typeof RAFFLE_IDS[number];
export const RAFFLE_LABELS: Record<RaffleId, string> = { merch: 'Merch giveaway', giftcard: '$25 gift-card giveaway', general: 'General raffle' };
function raffleFile(id: RaffleId) { return id === 'general' ? 'raffle-state.json' : `raffle-${id}-state.json`; }
export function inferRaffleId(title: string, cost?: number): RaffleId | null {
  const name = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/give\s*away/.test(name)) {
    if (/\bmerch(?:andise)?\b/.test(name) && (cost === undefined || cost === 1000)) return 'merch';
    if (/\$\s*25\b/.test(name) && (cost === undefined || cost === 1500)) return 'giftcard';
  }
  return inferRaffleTicketQuantity(title) !== null ? 'general' : null;
}
// Serialize whole read/modify/write operations, including EventSub and backfill.
let mutationTail: Promise<unknown> = Promise.resolve();
function mutate<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(work, work);
  mutationTail = result.catch(() => undefined);
  return result;
}
const RAFFLE_CONTEXT = { tenantId: 'spacemountainlive', username: 'raffle' };

export type RaffleEntrant = { userId: string; username: string; displayName: string; tickets: number };
export type RaffleRewardRule = { rewardId: string; title: string; tickets: number };
export type RaffleRedemption = {
  redemptionId: string; userId: string; username: string; displayName: string;
  rewardId: string; rewardTitle: string; ticketCount: number; status: string;
  redeemedAt: string; updatedAt: string;
};
export type RaffleDraw = {
  id: string; raffleId?: RaffleId; label?: string; cycleId: number; status: 'drawing' | 'complete'; startedAt: string; revealAt: string;
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
async function readState(raffleId: RaffleId = 'general'): Promise<RaffleState> {
  const state = await readJsonFile<RaffleState>(raffleFile(raffleId), initialState(), RAFFLE_CONTEXT);
  return { ...initialState(), ...state, rewardRules: state?.rewardRules || {}, redemptions: state?.redemptions || {}, history: Array.isArray(state?.history) ? state.history.slice(-25) : [] };
}
async function writeState(state: RaffleState, raffleId: RaffleId = 'general') { await writeJsonFile(raffleFile(raffleId), state, RAFFLE_CONTEXT); }

export function inferRaffleTicketQuantity(title: string): number | null {
  const normalized = String(title || '').toLowerCase().replace(/[×]/g, 'x').replace(/\s+/g, ' ').trim();
  if (!normalized.includes('raffle') && !normalized.includes('ticket')) return null;
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

async function recordRedemption(input: {
  redemptionId: string; userId?: string; username: string; displayName?: string; rewardId?: string;
  rewardTitle: string; rewardCost?: number; status?: string; redeemedAt?: string;
}) {
  const raffleId = inferRaffleId(input.rewardTitle, input.rewardCost);
  const inferred = raffleId === 'general' ? inferRaffleTicketQuantity(input.rewardTitle) : 1;
  if (raffleId === null || inferred === null) return { tracked: false, added: false, ticketsAdded: 0, totalTickets: 0 };
  const state = await readState(raffleId);
  if (state.cycleId > 1 && input.redeemedAt && Date.parse(input.redeemedAt) < Date.parse(state.openedAt)) {
    return { tracked: false, added: false, ticketsAdded: 0, totalTickets: 0 };
  }
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
  await writeState(state, raffleId);
  const normalizedUser = String(input.username || '').toLowerCase();
  const totalTickets = aggregate(state).filter((row) => (input.userId && row.userId === input.userId) || row.username === normalizedUser).reduce((sum, row) => sum + row.tickets, 0);
  const newlyCounted = !existing && status !== 'canceled';
  return { tracked: true, added: newlyCounted, ticketsAdded: newlyCounted ? reward.tickets : 0, totalTickets, reward, raffleId, raffleLabel: RAFFLE_LABELS[raffleId] };
}

export function recordRaffleRedemption(input: Parameters<typeof recordRedemption>[0]) { return mutate(() => recordRedemption(input)); }

export async function getRaffleTicketBalance(username: string, userId?: string, raffleId: RaffleId = 'general'): Promise<number> {
  const normalized = String(username || '').trim().toLowerCase();
  return aggregate(await readState(raffleId)).filter((row) => (userId && row.userId === userId) || row.username === normalized).reduce((sum, row) => sum + row.tickets, 0);
}
export async function getRaffleSummary(raffleId: RaffleId = 'general') {
  const state = await readState(raffleId);
  const entrants = aggregate(state);
  return { raffleId, label: RAFFLE_LABELS[raffleId], cycleId: state.cycleId, openedAt: state.openedAt, entrants, uniqueEntrants: entrants.length, totalTickets: entrants.reduce((sum, row) => sum + row.tickets, 0), rewardRules: Object.values(state.rewardRules).sort((a, b) => a.title.localeCompare(b.title)), draw: state.draw };
}
function shuffle<T>(source: T[]): T[] {
  const items = [...source];
  for (let i = items.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [items[i], items[j]] = [items[j], items[i]]; }
  return items;
}
async function startRaffleDrawUnlocked(raffleId: RaffleId = 'general'): Promise<RaffleDraw> {
  const state = await readState(raffleId);
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
    id: randomUUID(), raffleId, label: RAFFLE_LABELS[raffleId], cycleId: state.cycleId, status: 'drawing', startedAt: new Date(started).toISOString(),
    revealAt: new Date(started + Math.max(1, eliminationOrder.length) * stepMs + 3000).toISOString(),
    stepMs, totalTickets, entrants, eliminationOrder, winner,
  };
  state.draw = draw;
  await writeState(state, raffleId);
  return draw;
}
export function startRaffleDraw(raffleId: RaffleId = 'general') { return mutate(() => startRaffleDrawUnlocked(raffleId)); }

async function claimDueRaffleAnnouncementUnlocked(now = Date.now(), raffleId: RaffleId = 'general'): Promise<RaffleDraw | null> {
  const state = await readState(raffleId);
  const draw = state.draw;
  if (!draw || draw.announcedAt || draw.announcementClaimedAt || Date.parse(draw.revealAt) > now) return null;
  draw.status = 'complete'; draw.announcementClaimedAt = new Date(now).toISOString(); state.draw = draw; await writeState(state, raffleId); return draw;
}
export function claimDueRaffleAnnouncement(now = Date.now(), raffleId: RaffleId = 'general') { return mutate(() => claimDueRaffleAnnouncementUnlocked(now, raffleId)); }

async function markRaffleAnnouncedUnlocked(drawId: string, delivered: boolean, raffleId: RaffleId = 'general') {
  const state = await readState(raffleId);
  if (!state.draw || state.draw.id !== drawId) return;
  if (delivered) { state.draw.status = 'complete'; state.draw.announcedAt = new Date().toISOString(); }
  else delete state.draw.announcementClaimedAt;
  await writeState(state, raffleId);
}
export function markRaffleAnnounced(drawId: string, delivered: boolean, raffleId: RaffleId = 'general') { return mutate(() => markRaffleAnnouncedUnlocked(drawId, delivered, raffleId)); }

async function setRaffleRewardTicketsUnlocked(selector: string, tickets: number, raffleId: RaffleId = 'general') {
  const state = await readState(raffleId);
  const rules = Object.values(state.rewardRules).sort((a, b) => a.title.localeCompare(b.title));
  const numeric = /^\d+$/.test(String(selector || '').trim()) ? Number(selector) : 0;
  const target = numeric >= 1 && numeric <= rules.length
    ? rules[numeric - 1]
    : rules.find((rule) => rule.rewardId === selector || rule.title.toLowerCase() === String(selector || '').trim().toLowerCase());
  if (!target) throw new Error('I could not find that raffle reward. Use !raffle rewards first.');
  const nextTickets = Math.max(1, Math.min(1000, Math.floor(Number(tickets) || 0)));
  target.tickets = nextTickets;
  state.rewardRules[target.rewardId] = target;
  for (const redemption of Object.values(state.redemptions)) {
    if (redemption.rewardId === target.rewardId) redemption.ticketCount = nextTickets;
  }
  await writeState(state, raffleId);
  return target;
}

export function setRaffleRewardTickets(selector: string, tickets: number, raffleId: RaffleId = 'general') { return mutate(() => setRaffleRewardTicketsUnlocked(selector, tickets, raffleId)); }

export async function syncRaffleRedemptionsFromTwitch(tenantId = 'spacemountainlive') {
  const tokens = await getStoredTokens(tenantId);
  if (!tokens) throw new Error('No Twitch broadcaster OAuth is available for the raffle sync.');
  const clientId = tokens.twitchClientId || process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Twitch credentials are incomplete.');
  const accessToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);
  const validate = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!validate.ok) throw new Error('Twitch broadcaster token validation failed.');
  const validated = await validate.json() as any;
  const broadcasterId = String(validated?.user_id || '');
  if (!broadcasterId) throw new Error('Twitch broadcaster ID is unavailable.');
  const headers = { 'Client-ID': clientId, Authorization: `Bearer ${accessToken}` };
  const rewardsResponse = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}`, { headers });
  if (!rewardsResponse.ok) throw new Error('Twitch raffle rewards could not be loaded.');
  const rewardsPayload = await rewardsResponse.json() as any;
  const rewards = (Array.isArray(rewardsPayload?.data) ? rewardsPayload.data : []).filter((reward: any) => inferRaffleId(String(reward?.title || ''), Number(reward?.cost)) !== null);
  let imported = 0;
  for (const reward of rewards) {
    const rewardId = String(reward?.id || '');
    const title = String(reward?.title || '');
    if (!rewardId) continue;
    const raffleId = inferRaffleId(title, Number(reward.cost))!;
    await mutate(async () => {
      const state = await readState(raffleId);
      state.rewardRules[rewardId] ||= { rewardId, title, tickets: raffleId === 'general' ? inferRaffleTicketQuantity(title)! : 1 };
      await writeState(state, raffleId);
    });
    const currentCycle = await readState(raffleId);
    const openedAt = currentCycle.cycleId > 1 ? Date.parse(currentCycle.openedAt) : 0;
    for (const status of ['UNFULFILLED', 'FULFILLED', 'CANCELED']) {
      let after = '';
      do {
        const query = new URLSearchParams({ broadcaster_id: broadcasterId, reward_id: rewardId, status, first: '50' });
        if (after) query.set('after', after);
        const response = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?${query.toString()}`, { headers });
        if (!response.ok) break;
        const payload = await response.json() as any;
        const entries = Array.isArray(payload?.data) ? payload.data : [];
        for (const event of entries) {
          if (Date.parse(String(event?.redeemed_at || '')) < openedAt) continue;
          const result = await recordRaffleRedemption({
            redemptionId: String(event?.id || ''), userId: String(event?.user_id || ''), username: String(event?.user_login || ''),
            displayName: String(event?.user_name || event?.user_login || ''), rewardId, rewardTitle: title, rewardCost: Number(reward.cost),
            status: String(event?.status || status).toLowerCase(), redeemedAt: String(event?.redeemed_at || new Date().toISOString()),
          });
          if (result.tracked) imported += 1;
        }
        after = String(payload?.pagination?.cursor || '');
      } while (after);
    }
  }
  const summaries = await Promise.all(RAFFLE_IDS.map(id => getRaffleSummary(id)));
  return { rewards: rewards.length, imported, totalTickets: summaries.reduce((n, s) => n + s.totalTickets, 0), uniqueEntrants: new Set(summaries.flatMap(s => s.entrants.map(e => e.userId || e.username))).size };
}
async function resetRaffleCycleUnlocked(raffleId: RaffleId = 'general') {
  const state = await readState(raffleId); const entrants = aggregate(state);
  state.history.push({ cycleId: state.cycleId, closedAt: new Date().toISOString(), totalTickets: entrants.reduce((sum, row) => sum + row.tickets, 0), entrants: entrants.length, winner: state.draw?.winner?.username });
  state.history = state.history.slice(-25); state.cycleId += 1; state.openedAt = new Date().toISOString(); state.redemptions = {}; state.draw = null; await writeState(state, raffleId);
  return { cycleId: state.cycleId };
}

export function resetRaffleCycle(raffleId: RaffleId = 'general') { return mutate(() => resetRaffleCycleUnlocked(raffleId)); }
