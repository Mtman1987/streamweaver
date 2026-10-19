import { getSpmtServiceToken } from '../lib/spmt-service-token';
import {
  SPACEMOUNTAIN_SYSTEM_TENANT_ID,
  SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL,
} from '../lib/tenant';

export type SpaceMountainGoLiveState =
  | 'live'
  | 'already_live'
  | 'login_required'
  | 'local_host_active'
  | 'start_failed'
  | 'not_live'
  | 'verification_unavailable'
  | 'service_unavailable'
  | 'in_progress';

export type SpaceMountainGoLiveResult = {
  ok: boolean;
  state: SpaceMountainGoLiveState;
  startedAt?: string | null;
  verifiedAt?: string;
};

type ChatCommandInput = {
  message: string;
  channel: string;
  tenantId?: string;
  username: string;
  userId: string;
  self: boolean;
  mirrored: boolean;
  botAuthored: boolean;
  broadcasterBadge: boolean;
};

type GoLiveDependencies = {
  start: () => Promise<SpaceMountainGoLiveResult>;
  reply: (message: string) => Promise<unknown>;
};

const BROADCASTER_LOGIN = 'spacemountainlive';
const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export function isSpaceMountainGoLiveCommand(message: string, channel: string): boolean {
  return channel.replace(/^#/, '').trim().toLowerCase() === SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL
    && /^!golive$/i.test(String(message || '').trim());
}

export function isAuthorizedSpaceMountainGoLive(input: ChatCommandInput): boolean {
  // Twitch supplies the broadcaster badge and immutable user ID in its
  // authenticated IRC tags. Require both, plus the exact channel-owner login.
  // The SPMT control-profile owner (mtman1987) is not the Twitch channel login.
  return input.tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID
    && input.channel.replace(/^#/, '').trim().toLowerCase() === SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL
    && input.username.trim().toLowerCase() === BROADCASTER_LOGIN
    && Boolean(input.userId.trim())
    && input.broadcasterBadge === true
    && input.self !== true
    && input.mirrored !== true
    && input.botAuthored !== true;
}

function chatResultMessage(result: SpaceMountainGoLiveResult): string {
  switch (result.state) {
    case 'live':
      return '@spacemountainlive, Twitch confirms SpaceMountainLive is live.';
    case 'already_live':
      return '@spacemountainlive, Twitch already confirms SpaceMountainLive is live.';
    case 'login_required':
      return '@spacemountainlive, Restream needs you to sign in in the saved Studio browser. Twitch is not live, so I have not reported success.';
    case 'local_host_active':
      return '@spacemountainlive, the local Companion currently owns the Restream host. I did not start a second host; use the existing local Studio session.';
    case 'start_failed':
      return '@spacemountainlive, the saved Restream Studio could not start. Twitch is not live, so I have not reported success.';
    case 'not_live':
      return '@spacemountainlive, Restream was asked to start, but Twitch did not confirm SpaceMountainLive live within 90 seconds. No success reported.';
    case 'verification_unavailable':
      return '@spacemountainlive, I could not verify Twitch live status, so I will not claim the stream started.';
    case 'in_progress':
      return '@spacemountainlive, a SpaceMountainLive start/check is already in progress. I will not trigger a second start.';
    default:
      return '@spacemountainlive, the Restream control service is unavailable. I could not verify the broadcast, so I will not claim it started.';
  }
}

export async function handleSpaceMountainGoLiveMessage(
  input: ChatCommandInput,
  deps: GoLiveDependencies,
): Promise<boolean> {
  if (!isSpaceMountainGoLiveCommand(input.message, input.channel)) return false;
  // Consume this reserved command in the SpaceMountainLive channel, but silently
  // ignore anyone except the verified owner. Moderator status grants no access.
  if (!isAuthorizedSpaceMountainGoLive(input)) return true;

  try {
    await deps.reply('@spacemountainlive, checking the saved Restream browser now. I will only confirm once Twitch reports SpaceMountainLive live.');
  } catch {
    // A failed chat acknowledgement must not cause the start action to be skipped.
  }

  let result: SpaceMountainGoLiveResult;
  try {
    result = await deps.start();
  } catch {
    result = { ok: false, state: 'service_unavailable' };
  }

  // Never trust a positive state without an explicit successful result.
  if (!(result.ok && (result.state === 'live' || result.state === 'already_live'))) {
    const safeResult = {
      ...result,
      ok: false,
      state: result.state === 'live' || result.state === 'already_live'
        ? 'verification_unavailable' as const
        : result.state,
    };
    await deps.reply(chatResultMessage(safeResult)).catch(() => undefined);
    return true;
  }
  await deps.reply(chatResultMessage(result)).catch(() => undefined);
  return true;
}

let inFlight: Promise<SpaceMountainGoLiveResult> | null = null;

export async function requestSpaceMountainGoLive(): Promise<SpaceMountainGoLiveResult> {
  if (inFlight) return { ok: false, state: 'in_progress' };

  const execute = async (): Promise<SpaceMountainGoLiveResult> => {
    try {
      const token = await getSpmtServiceToken(['restream:control']);
      const response = await fetch(`${SPMT_BASE_URL}/api/internal/stream/golive`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(250_000),
      });
      const payload = await response.json().catch(() => null) as Partial<SpaceMountainGoLiveResult> | null;
      const allowedStates: SpaceMountainGoLiveState[] = [
        'live',
        'already_live',
        'login_required',
        'local_host_active',
        'start_failed',
        'not_live',
        'verification_unavailable',
        'service_unavailable',
        'in_progress',
      ];
      if (!response.ok || !payload || !allowedStates.includes(payload.state as SpaceMountainGoLiveState)) {
        return { ok: false, state: 'service_unavailable' };
      }
      const state = payload.state as SpaceMountainGoLiveState;
      const ok = payload.ok === true && (state === 'live' || state === 'already_live');
      return {
        ok,
        state: ok ? state : (state === 'live' || state === 'already_live' ? 'verification_unavailable' : state),
        ...(typeof payload.startedAt === 'string' || payload.startedAt === null ? { startedAt: payload.startedAt } : {}),
        ...(typeof payload.verifiedAt === 'string' ? { verifiedAt: payload.verifiedAt } : {}),
      };
    } catch {
      return { ok: false, state: 'service_unavailable' };
    }
  };

  inFlight = execute();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
