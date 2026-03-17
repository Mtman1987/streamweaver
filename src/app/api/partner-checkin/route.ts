import { NextRequest, NextResponse } from 'next/server';
import { getPartnerById } from '@/services/partner-checkin';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  
  if (!id) {
    return apiError('Missing id', { status: 400, code: 'MISSING_ID' });
  }

  const partner = getPartnerById(parseInt(id));
  
  if (!partner) {
    return apiError('Partner not found', { status: 404, code: 'PARTNER_NOT_FOUND' });
  }

  return apiOk(partner);
}
