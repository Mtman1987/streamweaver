
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { tenantPath } from '@/lib/tenant';

// SECURITY NOTE: This endpoint intentionally takes tenantId from the query string
// without authentication so generated image URLs can be embedded by Discord's
// CDN proxy (which fetches anonymously). Filenames are UUIDs so direct file
// access at /api/ai/image/file/[name] is effectively unguessable, but the
// library listing here exposes the generated images for any known tenantId
// and requested scope. Treat tenantIds as semi-public and do NOT store
// sensitive content in these directories. If auth is added later, the Discord
// embed flow needs a separate anonymous-fetchable image URL.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  const tenantId = (searchParams.get('tenantId') || '').trim();
  const scope = searchParams.get('scope') === 'private' ? 'private' : 'public';
  if (tenantId && !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    return NextResponse.json({ error: 'invalid tenantId' }, { status: 400 });
  }
  const storagePath = scope === 'private' ? 'data/private-generated-images' : 'data/generated-images';
  const dir = tenantId ? tenantPath(tenantId, storagePath) : `${process.cwd()}/${storagePath}`;
  let files: string[] = [];
  try { files = (await fs.readdir(dir)).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort().reverse(); } catch {}
  const rows = files.map((f) => {
    const safeName = escapeHtml(f);
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (scope === 'private') params.set('scope', scope);
    const query = params.toString();
    const url = escapeHtml(`/api/ai/image/file/${encodeURIComponent(f)}${query ? `?${query}` : ''}`);
    return `<div style="margin:12px 0"><a href="${url}" target="_blank">${safeName}</a><br/><img src="${url}" style="max-width:512px;border-radius:8px" /></div>`;
  }).join('');
  const title = scope === 'private' ? 'Private Generated Images' : 'Generated Images';
  return new NextResponse(`<!doctype html><html><body style="font-family:sans-serif;padding:16px"><h2>${title} (${files.length})</h2>${rows || '<p>No images yet.</p>'}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
