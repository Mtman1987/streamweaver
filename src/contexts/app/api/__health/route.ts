import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function GET(request: Request) {
  const headersList = await headers();
  const userAgent = headersList.get('user-agent') || 'unknown';
  const referer = headersList.get('referer') || 'none';
  const xForwardedFor = headersList.get('x-forwarded-for') || 'none';
  
  console.log('[Health] Health check called:', {
    userAgent,
    referer,
    xForwardedFor,
    url: request.url,
    timestamp: new Date().toISOString()
  });
  
  return NextResponse.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'streamweaver-next',
    version: '2.0',
    userAgent,
    referer
  });
}