/*
 * ACTIVE SHARED CLIENT — RESERVED FOR FUTURE NON-MTFIXIT OWNER DMS
 *
 * This helper is intentionally retained and authenticated with SPMT_API_KEY.
 * It is not part of the retired StreamWeaver mtfixit pipeline and currently
 * has no mtfixit caller. Search for `OWNER_DM_CLIENT_RESERVED` to identify it.
 */
export const OWNER_DM_CLIENT_RESERVED = true as const;

type DshOwnerDmResult = {
  success: boolean;
  channelId?: string;
  messageId?: string;
};

function getDshUrl(): string {
  return String(
    process.env.DISCORD_STREAM_HUB_URL ||
    process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL ||
    'https://discord-stream-hub-new.fly.dev',
  ).replace(/\/$/, '');
}

function getDshSecret(): string {
  return String(
    process.env.SPMT_API_KEY ||
    process.env.SPMT_PLATFORM_API_KEY ||
    '',
  ).trim();
}

/**
 * Reserved reusable client for future non-mtfixit owner notifications.
 * Do not reconnect this helper to StreamWeaver mtfixit handling.
 */
export async function sendOwnerDmThroughDsh(input: {
  message: string;
  fileName: string;
  fileContent: string;
}): Promise<DshOwnerDmResult> {
  const secret = getDshSecret();
  if (!secret) throw new Error('SPMT_API_KEY is not configured');

  const response = await fetch(`${getDshUrl()}/api/internal/owner-dm`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(input),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });

  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw new Error(String(payload.error || `DSH owner DM returned ${response.status}`));
  }

  return {
    success: Boolean(payload.success),
    channelId: String(payload.channelId || ''),
    messageId: String(payload.messageId || ''),
  };
}
