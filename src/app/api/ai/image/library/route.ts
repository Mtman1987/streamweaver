import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { tenantPath } from '@/lib/tenant';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { deletePrivateGeneratedImage } from '@/services/private-image-library';

// SECURITY NOTE: GET intentionally takes tenantId from the query string without
// authentication so generated image URLs can be embedded by Discord's CDN proxy.
// Mutating the library is different: DELETE always requires the signed-in
// StreamWeaver session to own the requested tenantId.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidTenantId(tenantId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(tenantId);
}

export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  const tenantId = (searchParams.get('tenantId') || '').trim();
  const scope = searchParams.get('scope') === 'private' ? 'private' : 'public';
  if (tenantId && !isValidTenantId(tenantId)) {
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

  const session = getTenantFromRequest(request);
  const canDelete = scope === 'private' && Boolean(tenantId) && session?.tenantId === tenantId;

  const rows = files.map((filename) => {
    const safeName = escapeHtml(filename);
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (scope === 'private') params.set('scope', scope);
    const query = params.toString();
    const imageUrl = `/api/ai/image/file/${encodeURIComponent(filename)}${query ? `?${query}` : ''}`;
    const safeImageUrl = escapeHtml(imageUrl);

    let deleteButton = '';
    if (canDelete) {
      const deleteParams = new URLSearchParams({
        tenantId,
        scope: 'private',
        name: filename,
      });
      const deleteUrl = escapeHtml(`/api/ai/image/library?${deleteParams.toString()}`);
      deleteButton = `<button class="delete-button" type="button" data-delete-url="${deleteUrl}" data-filename="${safeName}">Delete</button>`;
    }

    return `<article class="image-card" data-image-card>
      <div class="image-toolbar">
        <a href="${safeImageUrl}" target="_blank" rel="noopener noreferrer">Open full size</a>
        ${deleteButton}
      </div>
      <a href="${safeImageUrl}" target="_blank" rel="noopener noreferrer" class="image-link">
        <img src="${safeImageUrl}" loading="lazy" alt="${safeName}" />
      </a>
      <div class="filename" title="${safeName}">${safeName}</div>
    </article>`;
  }).join('');

  const title = scope === 'private' ? 'Private Generated Images' : 'Generated Images';
  const ownerNote = scope === 'private'
    ? canDelete
      ? '<p class="note">Scroll through your library and use <strong>Delete</strong> on any image you do not want to keep. Deleted images are removed from future carousel cycles too.</p>'
      : '<p class="note warning">Viewing mode. Sign in to StreamWeaver as this account in this browser to enable Delete buttons.</p>'
    : '';

  const deleteScript = canDelete ? `<script>
    document.addEventListener('click', async function (event) {
      const target = event.target;
      const button = target && target.closest ? target.closest('[data-delete-url]') : null;
      if (!button) return;

      const filename = button.getAttribute('data-filename') || 'this image';
      if (!window.confirm('Permanently delete ' + filename + '?')) return;

      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Deleting...';

      try {
        const response = await fetch(button.getAttribute('data-delete-url'), {
          method: 'DELETE',
          credentials: 'same-origin'
        });
        const payload = await response.json().catch(function () { return {}; });
        if (!response.ok) {
          throw new Error(payload.error || ('Delete failed (' + response.status + ')'));
        }

        const card = button.closest('[data-image-card]');
        if (card) card.remove();

        const countElement = document.getElementById('image-count');
        const currentCount = Number(countElement && countElement.textContent ? countElement.textContent : '0');
        const nextCount = Math.max(0, currentCount - 1);
        if (countElement) countElement.textContent = String(nextCount);

        const gallery = document.getElementById('image-gallery');
        if (gallery && nextCount === 0) {
          gallery.innerHTML = '<p class="empty">No images yet.</p>';
        }
      } catch (error) {
        window.alert(error && error.message ? error.message : 'Delete failed.');
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  </script>` : '';

  return new NextResponse(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; background: #111318; color: #f4f5f7; }
    .page { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .header { position: sticky; top: 0; z-index: 5; background: rgba(17,19,24,.96); backdrop-filter: blur(8px); padding: 10px 0 14px; border-bottom: 1px solid #30343c; }
    h2 { margin: 0 0 8px; }
    .note { margin: 0; color: #c9ced8; line-height: 1.45; }
    .warning { color: #f0c674; }
    #image-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding-top: 18px; }
    .image-card { min-width: 0; background: #1a1d24; border: 1px solid #30343c; border-radius: 12px; overflow: hidden; }
    .image-toolbar { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; }
    .image-toolbar a { color: #9ecbff; text-decoration: none; font-size: 14px; }
    .image-toolbar a:hover { text-decoration: underline; }
    .delete-button { border: 0; border-radius: 7px; padding: 8px 12px; background: #b4232d; color: white; font-weight: 700; cursor: pointer; }
    .delete-button:hover { filter: brightness(1.12); }
    .delete-button:disabled { opacity: .65; cursor: wait; }
    .image-link { display: block; background: #090a0d; }
    img { display: block; width: 100%; height: 340px; object-fit: contain; }
    .filename { padding: 10px 12px 12px; color: #9aa2af; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .empty { color: #aeb5c0; }
    @media (max-width: 600px) {
      .page { padding: 12px; }
      #image-gallery { grid-template-columns: 1fr; }
      img { height: auto; max-height: 70vh; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <h2>${title} (<span id="image-count">${files.length}</span>)</h2>
      ${ownerNote}
    </header>
    <section id="image-gallery">${rows || '<p class="empty">No images yet.</p>'}</section>
  </main>
  ${deleteScript}
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function DELETE(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  const tenantId = (searchParams.get('tenantId') || '').trim();
  const scope = searchParams.get('scope') === 'private' ? 'private' : 'public';
  const filename = (searchParams.get('name') || '').trim();

  if (!tenantId || !isValidTenantId(tenantId)) {
    return NextResponse.json({ error: 'invalid tenantId' }, { status: 400 });
  }
  if (scope !== 'private') {
    return NextResponse.json({ error: 'Only private image library deletion is supported.' }, { status: 400 });
  }

  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return NextResponse.json({ error: 'Sign in to StreamWeaver to delete images.' }, { status: 401 });
  }
  if (session.tenantId !== tenantId) {
    return NextResponse.json({ error: 'You can only delete images from your own library.' }, { status: 403 });
  }

  try {
    const result = await deletePrivateGeneratedImage(tenantId, filename);
    if (result === 'invalid') {
      return NextResponse.json({ error: 'invalid image filename' }, { status: 400 });
    }
    if (result === 'not_found') {
      return NextResponse.json({ error: 'image not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: filename });
  } catch (error) {
    console.error('[Private Image Library] Delete failed:', error);
    return NextResponse.json({ error: 'Failed to delete image.' }, { status: 500 });
  }
}
