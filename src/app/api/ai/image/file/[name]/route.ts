
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { tenantPath } from '@/lib/tenant';

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const searchParams = new URL(request.url).searchParams;
  const tenantId = (searchParams.get('tenantId') || '').trim();
  const scope = searchParams.get('scope') === 'private' ? 'private' : 'public';
  if (tenantId && !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    return NextResponse.json({ error: 'invalid tenantId' }, { status: 400 });
  }
  const { name: nameParam } = await params;
  const name = nameParam || '';
  if (!/^[a-f0-9-]+\.(gif|png|jpg|jpeg|webp)$/i.test(name)) {
    return NextResponse.json({ error: 'invalid file' }, { status: 400 });
  }
  const storagePath = scope === 'private' ? 'data/private-generated-images' : 'data/generated-images';
  const filePath = tenantId ? tenantPath(tenantId, `${storagePath}/${name}`) : `${process.cwd()}/${storagePath}/${name}`;
  try {
    const data = await fs.readFile(filePath);
    const ext = name.split('.').pop()?.toLowerCase();
    const ct = ext === 'gif'
      ? 'image/gif'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : 'image/png';
    return new NextResponse(data, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
