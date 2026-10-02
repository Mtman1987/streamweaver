export const RAFFLE_ELIMINATION_PAUSE_MS = 2000;
export const RAFFLE_CHAT_DELAY_MS = 15000;
export type WheelTiming = { startedAt: string; revealAt: string; stepMs: number; eliminationOrder: string[]; spinDurationsMs?: number[]; presentedAt?: string; visualRevealedAt?: string };
export function raffleDurationMs(spins: number[]) { return Math.max(8000, spins.reduce((sum, spin) => sum + spin + RAFFLE_ELIMINATION_PAUSE_MS, 0)); }
export function raffleWheelPhase(draw: WheelTiming, now: number) {
  if (draw.spinDurationsMs && !draw.presentedAt) return { count: 0, spinning: false, paused: false, progress: 0, complete: false };
  const elapsed = Math.max(0, now - Date.parse(draw.startedAt));
  if (!draw.spinDurationsMs) {
    const count = Math.min(draw.eliminationOrder.length, Math.floor(elapsed / Math.max(1, draw.stepMs)));
    return { count, spinning: now < Date.parse(draw.revealAt), paused: false, progress: (elapsed % Math.max(1, draw.stepMs)) / Math.max(1, draw.stepMs), complete: now >= Date.parse(draw.revealAt) };
  }
  let offset = 0;
  for (let count = 0; count < draw.spinDurationsMs.length; count++) {
    const spin = draw.spinDurationsMs[count];
    if (elapsed < offset + spin + RAFFLE_ELIMINATION_PAUSE_MS) {
      const progress = Math.min(1, (elapsed - offset) / spin);
      return { count, spinning: progress < 1, paused: progress >= 1, progress, complete: false };
    }
    offset += spin + RAFFLE_ELIMINATION_PAUSE_MS;
  }
  return { count: draw.eliminationOrder.length, spinning: false, paused: false, progress: 1, complete: now >= Date.parse(draw.revealAt) };
}
export function raffleAnnouncementReady(draw: WheelTiming, now: number) {
  if (draw.spinDurationsMs && (!draw.presentedAt || !draw.visualRevealedAt)) return false;
  const reveal = Math.max(Date.parse(draw.revealAt), Date.parse(draw.visualRevealedAt || draw.revealAt));
  return now >= reveal + RAFFLE_CHAT_DELAY_MS;
}
