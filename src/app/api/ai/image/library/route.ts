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

function clampRotationSeconds(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 90;
  return Math.max(60, Math.min(120, Math.round(parsed)));
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  const tenantId = (searchParams.get('tenantId') || '').trim();
  const scope = searchParams.get('scope') === 'private' ? 'private' : 'public';
  const rotating = searchParams.get('view') === 'rotate' || searchParams.get('rotate') === '1';
  const rotationSeconds = clampRotationSeconds(searchParams.get('interval'));
  if (tenantId && !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    return NextResponse.json({ error: 'invalid tenantId' }, { status: 400 });
  }

  const storagePath = scope === 'private' ? 'data/private-generated-images' : 'data/generated-images';
  const dir = tenantId ? tenantPath(tenantId, storagePath) : `${process.cwd()}/${storagePath}`;
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir))
      .filter((file) => /\.(gif|png|jpg|jpeg|webp)$/i.test(file))
      .sort()
      .reverse();
  } catch {}

  const urls = files.map((file) => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (scope === 'private') params.set('scope', scope);
    const query = params.toString();
    return `/api/ai/image/file/${encodeURIComponent(file)}${query ? `?${query}` : ''}`;
  });
  const title = scope === 'private' ? 'Private Generated Images' : 'Generated Images';

  if (rotating) {
    const requestedImage = searchParams.get('image') || '';
    const initialIndex = Math.max(0, files.indexOf(requestedImage));
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} — rotating</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background:#090b12; color:#f5f7ff; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; padding:1rem; box-sizing:border-box; }
    main { width:min(100%, 72rem); text-align:center; }
    img { display:block; width:100%; max-height:78vh; object-fit:contain; border-radius:1rem; background:#111522; box-shadow:0 1rem 4rem rgba(0,0,0,.35); }
    .meta { margin-top:.75rem; color:#b9c0d4; font-size:.9rem; }
    a { color:#a9c7ff; }
  </style>
</head>
<body>
  <main>
    ${urls.length ? '<img id="rotating-image" alt="Rotating generated image" />' : '<p>No images yet.</p>'}
    <div class="meta" id="rotation-status">${urls.length ? `Rotating every ${rotationSeconds} seconds.` : ''}</div>
    <div class="meta"><a href="?${escapeHtml(new URLSearchParams({ ...(tenantId ? { tenantId } : {}), ...(scope === 'private' ? { scope } : {}) }).toString())}">Open full library</a></div>
  </main>
  <script>
    const files = ${safeJson(files)};
    const urls = ${safeJson(urls)};
    const intervalMs = ${rotationSeconds * 1000};
    let index = ${initialIndex};
    const image = document.getElementById('rotating-image');
    const status = document.getElementById('rotation-status');

    function show(nextIndex) {
      if (!image || !urls.length) return;
      index = ((nextIndex % urls.length) + urls.length) % urls.length;
      const separator = urls[index].includes('?') ? '&' : '?';
      image.src = urls[index] + separator + 'v=' + Date.now();
      image.alt = files[index] || 'Generated image';
      if (status) status.textContent = 'Image ' + (index + 1) + ' of ' + urls.length + ' — rotating every ${rotationSeconds} seconds.';

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('view', 'rotate');
      nextUrl.searchParams.set('interval', String(${rotationSeconds}));
      nextUrl.searchParams.set('image', files[index]);
      nextUrl.searchParams.set('slide', String(index + 1));
      nextUrl.searchParams.set('v', String(Math.floor(Date.now() / intervalMs)));
      history.replaceState(null, '', nextUrl);
    }

    show(index);
    if (urls.length > 1) window.setInterval(() => show(index + 1), intervalMs);
  </script>
</body>
</html>`;
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }

  const rows = files.map((file, index) => {
    const safeName = escapeHtml(file);
    const url = escapeHtml(urls[index]);
    return `<div style="margin:12px 0"><a href="${url}" target="_blank">${safeName}</a><br/><img src="${url}" style="max-width:512px;border-radius:8px" /></div>`;
  }).join('');
  const rotateParams = new URLSearchParams();
  if (tenantId) rotateParams.set('tenantId', tenantId);
  if (scope === 'private') rotateParams.set('scope', scope);
  rotateParams.set('view', 'rotate');
  rotateParams.set('interval', String(rotationSeconds));
  return new NextResponse(
    `<!doctype html><html><body style="font-family:sans-serif;padding:16px"><h2>${title} (${files.length})</h2><p><a href="?${escapeHtml(rotateParams.toString())}">Open rotating view</a></p>${rows || '<p>No images yet.</p>'}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' } },
  );
}
