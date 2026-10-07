export function assertTwitchDeliveryReceipt(payload: unknown): asserts payload is { success: true } {
  const receipt = payload as { success?: boolean; skipped?: boolean; reason?: string; error?: string } | null;
  if (receipt?.success !== true || receipt.skipped === true) {
    throw new Error(receipt?.error || (receipt?.skipped
      ? 'Twitch send skipped: ' + (receipt.reason || 'not delivered')
      : 'Twitch send did not confirm delivery'));
  }
}
