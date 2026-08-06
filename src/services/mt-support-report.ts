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

/**
 * StreamWeaver no longer owns !mtfixit. DSH is the sole command ingress and
 * repair-pipeline owner. These compatibility exports remain temporarily so
 * older dispatcher call sites compile while always declining the command.
 */
export function detectMtFixItIntent(_message: string): { matched: boolean; description: string } {
  return { matched: false, description: '' };
}

export function beginPendingMtSupportRequest(_context: SupportContext): void {}

export function hasPendingMtSupportRequest(_context: SupportContext): boolean {
  return false;
}

export function consumePendingMtSupportRequest(_context: SupportContext): boolean {
  return false;
}

export function getMtSupportPrompt(_platform: SupportPlatform): string {
  return 'Repair requests are handled by DiscordStreamHub.';
}

export function getMtFixItPublicReply(username: string): string {
  return `@${username}, use the DSH !mtfixit command for repair requests.`;
}

export async function submitMtSupportReport(_input: SubmitSupportReportInput): Promise<SubmitSupportReportResult> {
  return {
    ok: false,
    error: 'StreamWeaver mtfixit handling is disabled; DiscordStreamHub owns this workflow.',
  };
}
