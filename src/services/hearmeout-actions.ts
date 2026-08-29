const HEARMEOUT_URL = String(
  process.env.HEARMEOUT_BASE_URL || process.env.NEXT_PUBLIC_HEARMEOUT_URL || 'https://hearmeout-main.fly.dev',
).replace(/\/+$/, '');

export type HearMeOutBotAction = 'hmo.media.state.read' | 'hmo.media.request' | 'hmo.media.control';

export type HearMeOutBotActionPayload = {
  action: HearMeOutBotAction;
  tenantId: string;
  roomId?: string;
  sessionId?: string;
  actorUserId?: string;
  actorName?: string;
  query?: string;
  control?: string;
  value?: number;
  idempotencyKey?: string;
};

function getHearMeOutServiceSecret(): string {
  return String(
    process.env.HEARMEOUT_SERVICE_SECRET || process.env.STREAMWEAVER_SECRET || process.env.BOT_SECRET_KEY || '',
  ).trim();
}

export async function executeHearMeOutBotAction(payload: HearMeOutBotActionPayload): Promise<Record<string, unknown>> {
  const secret = getHearMeOutServiceSecret();
  if (!secret) throw new Error('HEARMEOUT_SERVICE_SECRET is not configured');
  const response = await fetch(`${HEARMEOUT_URL}/api/internal/bot/actions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(55_000) : undefined,
  });
  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok) throw new Error(String(data?.error || `HearMeOut action failed (${response.status})`));
  if (data?.success !== true) throw new Error(`HearMeOut did not confirm ${payload.action}`);
  return data;
}
