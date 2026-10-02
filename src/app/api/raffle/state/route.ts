import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { RAFFLE_IDS, acknowledgeRafflePresentation, claimDueRaffleAnnouncement, getRaffleSummary, markRaffleAnnounced, syncRaffleRedemptionsFromTwitch } from '@/services/raffle-system';
import { reactStellaLoungeEvent } from '@/services/stella-lounge-host';
import { sendTwitchChatMessage } from '@/services/twitch';
import { queueTtsOverlay } from '@/services/tts-overlay-queue';
import { SPACEMOUNTAIN_SYSTEM_TENANT_ID, SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

let lastAutoSyncAt = 0;
let autoSyncPromise: Promise<unknown> | null = null;
const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;

export async function GET(_request: NextRequest) {
  const presentationId = _request.nextUrl.searchParams.get('presentationId');
  const stage = _request.nextUrl.searchParams.get('presentationStage');
  if (presentationId && (stage === 'shown' || stage === 'revealed')) {
    await acknowledgeRafflePresentation(presentationId, stage);
  }
  let summaries = await Promise.all(RAFFLE_IDS.map(id => getRaffleSummary(id)));
  const now = Date.now();
  if (summaries.some(s => s.rewardRules.length === 0) && now - lastAutoSyncAt >= AUTO_SYNC_INTERVAL_MS) {
    lastAutoSyncAt = now;
    autoSyncPromise ||= syncRaffleRedemptionsFromTwitch(SPACEMOUNTAIN_SYSTEM_TENANT_ID)
      .catch((error) => console.warn('[Raffle] Automatic Twitch backfill failed:', error))
      .finally(() => { autoSyncPromise = null; });
    // Backfill must not delay the wheel's first frame.
    summaries = await Promise.all(RAFFLE_IDS.map(id => getRaffleSummary(id)));
  }

  void (async () => {
  for (const raffleId of RAFFLE_IDS) {
    const due = await claimDueRaffleAnnouncement(now, raffleId);
    if (due) {
      let delivered = false;
      try {
        const result = await reactStellaLoungeEvent({
          kind: 'game-winner',
          actor: due.winner.displayName || due.winner.username,
          text: `${due.label || 'The Space Mountain raffle'} finished. ${due.winner.displayName || due.winner.username} won from ${due.totalTickets} total tickets across ${due.entrants.length} entrants.`,
          metadata: { game: due.label || 'Space Mountain raffle', tickets: due.winner.tickets, totalTickets: due.totalTickets, entrants: due.entrants.length },
        });
        delivered = result.delivered;
        if (!delivered) {
          const fallback = `🎟️🚀 ${due.label || 'Raffle'} complete — @${due.winner.username} is our winner! Congratulations!`;
          await sendTwitchChatMessage(fallback, 'bot', SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL, SPACEMOUNTAIN_SYSTEM_TENANT_ID);
          await queueTtsOverlay(fallback, SPACEMOUNTAIN_SYSTEM_TENANT_ID).catch(() => null);
          delivered = true;
        }
      } catch (error) { console.warn('[Raffle] Stella winner announcement failed:', error); }
      await markRaffleAnnounced(due.id, delivered, raffleId);
    }
  }
  }
  )().catch(error => console.warn('[Raffle] Announcement poll failed:', error));
  const selected = _request.nextUrl.searchParams.get('raffle');
  const summary = summaries.find(s => s.raffleId === selected) || [...summaries].filter(s => s.draw).sort((a,b) => Date.parse(b.draw!.startedAt) - Date.parse(a.draw!.startedAt))[0] || summaries[0];
  return apiOk({ raffles: summaries.map(({entrants, ...summary}) => summary), raffleId: summary.raffleId, label: summary.label, cycleId: summary.cycleId, totalTickets: summary.totalTickets, uniqueEntrants: summary.uniqueEntrants, draw: summary.draw, serverTime: new Date().toISOString() });
}
