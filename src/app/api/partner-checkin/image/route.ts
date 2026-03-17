import { NextRequest, NextResponse } from 'next/server';
import { getPartnerById } from '@/services/partner-checkin';
import fs from 'fs';
import { apiError } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  
  if (!id) {
    return apiError('Missing id', { status: 400, code: 'MISSING_ID' });
  }

  const partner = getPartnerById(parseInt(id));
  
  if (!partner) {
    return apiError('Partner not found', { status: 404, code: 'PARTNER_NOT_FOUND' });
  }

  try {
    const imageBuffer = fs.readFileSync(partner.imagePath);
    const ext = partner.imagePath.split('.').pop()?.toLowerCase();
    const contentType = ext === 'gif' ? 'image/gif' : 'image/png';
    
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('[Partner Checkin] Image error:', error);
    return apiError('Image not found', { status: 404, code: 'IMAGE_NOT_FOUND' });
  }
}
