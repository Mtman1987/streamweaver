import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url || typeof url !== 'string') {
    return apiError('Missing URL', { status: 400, code: 'MISSING_URL' });
  }

  try {
    const response = await fetch(url);
    const content = await response.text();

    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': 'attachment; filename="cards.txt"',
      },
    });
  } catch (error) {
    return apiError('Failed to fetch file', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
