
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { tenantPath } from '@/lib/tenant';

export async function GET(request: NextRequest) {
  const tenantId = (new URL(request.url).searchParams.get('tenantId') || '').trim();
  const dir = tenantId ? tenantPath(tenantId, 'data/generated-images') : `${process.cwd()}/data/generated-images`;
  let files: string[] = [];
  try { files = (await fs.readdir(dir)).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort().reverse(); } catch {}
  const rows = files.map((f) => {
    const url = `/api/ai/image/file/${encodeURIComponent(f)}${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`;
    return `<div style="margin:12px 0"><a href="${url}" target="_blank">${f}</a><br/><img src="${url}" style="max-width:512px;border-radius:8px" /></div>`;
  }).join('');
  return new NextResponse(`<!doctype html><html><body style="font-family:sans-serif;padding:16px"><h2>Generated Images (${files.length})</h2>${rows || '<p>No images yet.</p>'}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
