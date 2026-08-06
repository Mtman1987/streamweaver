/*
 * ============================================================================
 * DEPRECATED / NO LONGER USED: STREAMWEAVER MTFIXIT INGRESS
 * ============================================================================
 * Ownership moved to DiscordStreamHub. These exports are inert compatibility
 * shims only and must not be connected to new command, webhook, poller, or
 * dispatcher routes. Search for `STREAMWEAVER_MTFIXIT_RETIRED` to find every
 * intentionally retained legacy surface.
 *
 * Removal condition: delete these shims after the remaining dispatcher imports
 * have been removed in a dedicated cleanup change.
 * ============================================================================
 */

export const STREAMWEAVER_MTFIXIT_RETIRED = true as const;

const RETIRED_REASON =
  'StreamWeaver mtfixit handling is retired; DiscordStreamHub owns this workflow.';

type SupportPlatform = 'twitch' | 'discord';
type SupportContext = {
  platform: SupportPlatform;
  tenantId?: string;
  username: string;
  channelId?: string;
  reporterId?: string;
};
type SubmitSupportReportInput = SupportContext & {
  description: string;
  triggerMessage: string;
};
type SubmitSupportReportResult = {
  ok: boolean;
  jobId?: string;
  dashboardUrl?: string;
  dmSent?: boolean;
  dmChannelId?: string;
  error?: string;
};

/** @deprecated STREAMWEAVER_MTFIXIT_RETIRED — DSH is the sole command ingress. */
export function detectMtFixItIntent(_message: string): { matched: boolean; description: string } {
  return { matched: false, description: '' };
}

/** @deprecated STREAMWEAVER_MTFIXIT_RETIRED — pending state is no longer used. */
export function beginPendingMtSupportRequest(_context: SupportContext): void {}

/** @deprecated STREAMWEAVER_MTFIXIT_RETIRED — pending state is no longer used. */
export function hasPendingMtSupportRequest(_context: SupportContext): boolean {
  return false;
}

/** @deprecated STREAMWEAVER_MTFIXIT_RETIRED — pending state is no longer used. */
export function consumePendingMtSupportRequest(_context: SupportContext): boolean {
  return false;
}

/** @deprecated STREAMWEAVER_MTFIXIT_RETIRED — prompts are owned by DSH. */
export function getMtSupportPrompt(_platform: SupportPlatform): string {
  return 'Repair requests are handled by DiscordStreamHub.';
}

/** @deprecated STREAMWEAVER_MTFIXIT_RETIRED — public replies are owned by DSH. */
export function getMtFixItPublicReply(username: string): string {
  return `@${username}, use the DSH !mtfixit command for repair requests.`;
}

/**
 * @deprecated STREAMWEAVER_MTFIXIT_RETIRED — this must never create a job.
 * A warning is emitted if a stale caller reaches this compatibility shim.
 */
export async function submitMtSupportReport(_input: SubmitSupportReportInput): Promise<SubmitSupportReportResult> {
  console.warn(`[STREAMWEAVER_MTFIXIT_RETIRED] Blocked stale mtfixit submission. ${RETIRED_REASON}`);
  return {
    ok: false,
    error: RETIRED_REASON,
  };
}
