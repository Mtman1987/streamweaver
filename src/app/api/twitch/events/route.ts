import { NextRequest, NextResponse } from 'next/server';
import { addPoints, getPointSettings } from '@/services/points';
import { getStoredTokens } from '@/lib/token-utils.server';
import { listTenants } from '@/lib/tenant';
import {
  getInternalServiceSecrets,
  hasInternalServiceAccess,
} from '@/lib/internal-service-auth';

type TenantEventBody = {
  type?: string;
  tenantId?: string;
  channel?: string;
  twitchLogin?: string;
  username?: string;
  bits?: number | string;
  viewers?: number | string;
  quantity?: number | string;
  months?: number | string;
  tier?: number | string;
};

function positiveInt(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tierNumber(value: unknown): 1 | 2 | 3 {
  const raw = positiveInt(value, 1);
  if (raw >= 3000 || raw === 3) return 3;
  if (raw >= 2000 || raw === 2) return 2;
  return 1;
}

async function resolveTenant(body: TenantEventBody) {
  const tenantIds = await listTenants();
  const requested = String(body.tenantId || '').trim();
  const channel = String(body.channel || '').replace(/^#/, '').trim().toLowerCase();

  if (requested) {
    if (!tenantIds.includes(requested)) return null;
    const tokens = await getStoredTokens(requested).catch(() => null);
    return {
      tenantId: requested,
      username: tokens?.broadcasterUsername || channel || requested,
    };
  }

  if (!channel) return null;
  for (const tenantId of tenantIds) {
    const tokens = await getStoredTokens(tenantId).catch(() => null);
    if (String(tokens?.broadcasterUsername || '').toLowerCase() === channel) {
      return { tenantId, username: tokens?.broadcasterUsername || channel };
    }
  }
  return null;
}

// Tenant-only Twitch event ingress. Global SPMT XP is owned by DiscordStreamHub's
// direct all-members listener and is never written from this route.
export async function POST(request: NextRequest) {
  try {
    const configuredSecrets = getInternalServiceSecrets();
    if (configuredSecrets.length > 0 && !hasInternalServiceAccess(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as TenantEventBody;
    const type = String(body.type || '').trim().toLowerCase();
    const user = String(body.twitchLogin || body.username || '').trim().toLowerCase();
    if (!type || !user) {
      return NextResponse.json({ error: 'type and twitchLogin required' }, { status: 400 });
    }

    const tenant = await resolveTenant(body);
    if (!tenant) {
      return NextResponse.json({
        success: true,
        skipped: true,
        scope: 'tenant',
        reason: 'tenant-not-found',
      });
    }

    if (type === 'chat') {
      return NextResponse.json({
        success: true,
        skipped: true,
        scope: 'tenant',
        tenantId: tenant.tenantId,
        reason: 'direct-listener-owned',
      });
    }

    const ctx = { tenantId: tenant.tenantId, username: tenant.username };
    const settings = await getPointSettings(ctx);
    const configured = settings.eventPoints;
    const tier = tierNumber(body.tier);
    const quantity = positiveInt(body.quantity, 1);
    let points = 0;
    let reason = `twitch-event:${type}`;

    switch (type) {
      case 'follow':
        points = configured.follow;
        break;
      case 'subscribe':
      case 'subscription':
      case 'sub':
        points = configured.subscribe + configured[`tier${tier}` as 'tier1' | 'tier2' | 'tier3'];
        break;
      case 'resub':
        points = configured.resub
          + configured[`tier${tier}` as 'tier1' | 'tier2' | 'tier3']
          + configured.monthBonus * positiveInt(body.months, 0);
        break;
      case 'gift_sub':
      case 'gifted_subscription':
      case 'subgift':
        points = configured.giftSub * quantity;
        if (configured.giftSubTierBoost) points *= tier;
        break;
      case 'cheer':
      case 'bits': {
        const bits = positiveInt(body.bits, 0);
        if (!bits) {
          return NextResponse.json({ success: true, skipped: true, scope: 'tenant', reason: 'zero-bits' });
        }
        points = configured.cheer + Math.floor(bits * configured.bitsMultiplier);
        break;
      }
      case 'raid':
        points = configured.raid + positiveInt(body.viewers, 0) * configured.raidPerViewer;
        break;
      case 'host':
        points = configured.host;
        break;
      default:
        return NextResponse.json({
          success: true,
          skipped: true,
          scope: 'tenant',
          tenantId: tenant.tenantId,
          reason: `unknown-type:${type}`,
        });
    }

    if (!Number.isFinite(points) || points <= 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        scope: 'tenant',
        tenantId: tenant.tenantId,
        reason: 'zero-configured-points',
      });
    }

    const result = await addPoints(user, Math.floor(points), reason, ctx);
    return NextResponse.json({
      success: true,
      scope: 'tenant',
      tenantId: tenant.tenantId,
      pointsAwarded: Math.floor(points),
      balance: result.points,
    });
  } catch (error) {
    console.error('[TenantTwitchEvents] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
