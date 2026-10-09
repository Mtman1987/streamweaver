export function assertTwitchDeliveryReceipt(payload: unknown): asserts payload is { success: true } {
  const receipt = payload as { success?: boolean; skipped?: boolean; reason?: string; error?: string } | null;
  if (receipt?.success !== true || receipt.skipped === true) {
    throw new Error(receipt?.error || (receipt?.skipped
      ? 'Twitch send skipped: ' + (receipt.reason || 'not delivered')
      : 'Twitch send did not confirm delivery'));
  }
}


// These responses require account/channel repair, not a process restart or an
// identical fallback send. Keep transient transport/provider failures retryable.
export function isNonRestartableTwitchDeliveryFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /shared-bot-asleep-or-channel-not-authorized|Shared bot is asleep or this channel is not authorized|Shared chat source-only send (?:failed|skipped).+\((?:permission|broadcaster-not-found|sender-not-found|sender-unavailable)\)/i.test(message);
}
