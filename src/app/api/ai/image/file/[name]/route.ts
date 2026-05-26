
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { tenantPath } from '@/lib/tenant';

export async function GET(request: NextRequest, { params }: { params: { name: string } }) {
  const tenantId = (new URL(request.url).searchParams.get('tenantId') || '').trim();
  const name = params.name || '';
  if (!/^[a-f0-9-]+\.(png|jpg|jpeg|webp)$/i.test(name)) {
    return NextResponse.json({ error: 'invalid file' }, { status: 400 });
  }
  if (tenantId && !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    return NextResponse.json({ error: 'invalid tenantId' }, { status: 400 });
  }
  const filePath = tenantId ? tenantPath(tenantId, `data/generated-images/${name}`) : `${process.cwd()}/data/generated-images/${name}`;
  try {
    const data = await fs.readFile(filePath);
    const ext = name.split('.').pop()?.toLowerCase();
    const ct = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return new NextResponse(data, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
