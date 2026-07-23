import { NextRequest, NextResponse } from 'next/server';
import { generateTTS } from '@/services/tts-provider';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { hasMountainViewBridgeAccess } from '@/lib/internal-service-auth';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const text = (url.searchParams.get('text') || '').trim();
    const session = getTenantFromRequest(request);
    const bridgeTenant = hasMountainViewBridgeAccess(request)
      ? (url.searchParams.get('tenantId') || '').trim()
      : '';
    const tenantId = session?.tenantId || bridgeTenant;
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!text) {
      return NextResponse.json({ error: 'text query param is required' }, { status: 400 });
    }

    const audioDataUri = await generateTTS(text, undefined, tenantId);
    const match = audioDataUri.match(/^data:audio\/(mpeg|mp3|wav);base64,(.+)$/i);
    if (!match) {
      return NextResponse.json({ error: 'Invalid TTS audio format' }, { status: 500 });
    }

    const audioBuffer = Buffer.from(match[2], 'base64');
    const contentType = match[1] === 'wav' ? 'audio/wav' : 'audio/mpeg';
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'TTS play failed' }, { status: 500 });
  }
}
