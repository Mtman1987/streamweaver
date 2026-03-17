import { NextRequest, NextResponse } from 'next/server';
import { getPartnerById } from '@/services/partner-checkin';
import { getConfigSection } from '@/lib/local-config/service';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return apiError('Missing id', { status: 400, code: 'MISSING_ID' });

  const cfg = await getConfigSection('redeems');
  const { discordGuildId, discordRoleName } = cfg.partnerCheckin;
  if (!discordGuildId || !discordRoleName) return apiError('Partner check-in not configured', { status: 500, code: 'NOT_CONFIGURED' });

  const partner = await getPartnerById(parseInt(id), discordGuildId, discordRoleName);
  if (!partner) return apiError('Partner not found', { status: 404, code: 'PARTNER_NOT_FOUND' });

  return apiOk(partner);
}
