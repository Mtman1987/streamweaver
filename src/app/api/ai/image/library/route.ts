
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { tenantPath } from '@/lib/tenant';

// SECURITY NOTE: This endpoint intentionally takes tenantId from the query string
// without authentication so generated image URLs can be embedded by Discord's
// CDN proxy (which fetches anonymously). Filenames are UUIDs so direct file
// access at /api/ai/image/file/[name] is effectively unguessable, but the
// library listing here exposes the full set of generated images for any
// known tenantId. Treat tenantIds as semi-public and do NOT store sensitive
// content in this directory. If auth is added later, the Discord embed flow
// needs a separate anonymous-fetchable image URL.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(request: NextRequest) {
  const tenantId = (new URL(request.url).searchParams.get('tenantId') || '').trim();
  const dir = tenantId ? tenantPath(tenantId, 'data/generated-images') : `${process.cwd()}/data/generated-images`;
  let files: string[] = [];
  try { files = (await fs.readdir(dir)).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort().reverse(); } catch {}
  const rows = files.map((f) => {
    const safeName = escapeHtml(f);
    const url = escapeHtml(`/api/ai/image/file/${encodeURIComponent(f)}${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`);
    return `<div style="margin:12px 0"><a href="${url}" target="_blank">${safeName}</a><br/><img src="${url}" style="max-width:512px;border-radius:8px" /></div>`;
  }).join('');
  return new NextResponse(`<!doctype html><html><body style="font-family:sans-serif;padding:16px"><h2>Generated Images (${files.length})</h2>${rows || '<p>No images yet.</p>'}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
