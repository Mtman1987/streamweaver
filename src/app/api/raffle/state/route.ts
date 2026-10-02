import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { claimDueRaffleAnnouncement, getRaffleSummary, markRaffleAnnounced, syncRaffleRedemptionsFromTwitch } from '@/services/raffle-system';
import { reactStellaLoungeEvent } from '@/services/stella-lounge-host';
import { sendTwitchChatMessage } from '@/services/twitch';
import { queueTtsOverlay } from '@/services/tts-overlay-queue';
import { SPACEMOUNTAIN_SYSTEM_TENANT_ID, SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

let lastAutoSyncAt = 0;
let autoSyncPromise: Promise<unknown> | null = null;
const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;

export async function GET(_request: NextRequest) {
  let summary = await getRaffleSummary();
  const now = Date.now();
  if (summary.rewardRules.length === 0 && now - lastAutoSyncAt >= AUTO_SYNC_INTERVAL_MS) {
    lastAutoSyncAt = now;
    autoSyncPromise ||= syncRaffleRedemptionsFromTwitch(SPACEMOUNTAIN_SYSTEM_TENANT_ID)
      .catch((error) => console.warn('[Raffle] Automatic Twitch backfill failed:', error))
      .finally(() => { autoSyncPromise = null; });
    await autoSyncPromise;
    summary = await getRaffleSummary();
  }

  const due = await claimDueRaffleAnnouncement();
  if (due) {
    let delivered = false;
    try {
      const result = await reactStellaLoungeEvent({
        kind: 'game-winner',
        actor: due.winner.displayName || due.winner.username,
        text: `The Space Mountain raffle finished. ${due.winner.displayName || due.winner.username} won from ${due.totalTickets} total tickets across ${due.entrants.length} entrants.`,
        metadata: { game: 'Space Mountain raffle', tickets: due.winner.tickets, totalTickets: due.totalTickets, entrants: due.entrants.length },
      });
      delivered = result.delivered;
      if (!delivered) {
        const fallback = `🎟️🚀 Raffle complete — @${due.winner.username} is our winner! Congratulations!`;
        await sendTwitchChatMessage(fallback, 'bot', SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL, SPACEMOUNTAIN_SYSTEM_TENANT_ID);
        await queueTtsOverlay(fallback, SPACEMOUNTAIN_SYSTEM_TENANT_ID).catch(() => null);
        delivered = true;
      }
    } catch (error) { console.warn('[Raffle] Stella winner announcement failed:', error); }
    await markRaffleAnnounced(due.id, delivered);
  }
  summary = await getRaffleSummary();
  return apiOk({ cycleId: summary.cycleId, totalTickets: summary.totalTickets, uniqueEntrants: summary.uniqueEntrants, draw: summary.draw, serverTime: new Date().toISOString() });
}
