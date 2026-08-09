import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { tenantPath } from '@/lib/tenant';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  deletePrivateGeneratedImage,
  isSafePrivateGeneratedGifFilename,
  readPrivateGeneratedGif,
} from '@/services/private-image-library';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import {
  getDiscordMediaPublicPath,
  importDiscordStreamHubMedia,
  isDiscordStreamHubStoredMediaUrl,
  readTenantDiscordMedia,
  writeDiscordMedia,
} from '@/lib/discord-media-store';
import { readUserConfigSync, writeUserConfig } from '@/lib/user-config';
import { writePrivateChatSettings } from '@/lib/private-chat-settings-store';

// SECURITY NOTE: GET intentionally takes tenantId from the query string without
// authentication so generated image URLs can be embedded by Discord's CDN proxy.
// Mutating the library is different: DELETE and POST always require the signed-in
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

function libraryMediaUrl(tenantId: string, scope: 'private' | 'public', filename: string): string {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (scope === 'private') params.set('scope', scope);
  const query = params.toString();
  return `/api/ai/image/file/${encodeURIComponent(filename)}${query ? `?${query}` : ''}`;
}

function renderCard(input: {
  filename: string;
  tenantId: string;
  scope: 'private' | 'public';
  canMutate: boolean;
  gif: boolean;
}): string {
  const safeName = escapeHtml(input.filename);
  const imageUrl = libraryMediaUrl(input.tenantId, input.scope, input.filename);
  const safeImageUrl = escapeHtml(imageUrl);

  let controls = '';
  if (input.canMutate) {
    const deleteParams = new URLSearchParams({
      tenantId: input.tenantId,
      scope: 'private',
      name: input.filename,
    });
    const deleteUrl = escapeHtml(`/api/ai/image/library?${deleteParams.toString()}`);
    controls += `<button class="delete-button" type="button" data-delete-url="${deleteUrl}" data-filename="${safeName}">Delete</button>`;
    if (input.gif) {
      controls += `<button class="apply-button" type="button" data-apply-gif="${safeName}" data-tenant-id="${escapeHtml(input.tenantId)}">Apply to DM</button>`;
    }
  }

  return `<article class="image-card" data-image-card data-library-kind="${input.gif ? 'gif' : 'image'}">
    <div class="image-toolbar">
      <a href="${safeImageUrl}" target="_blank" rel="noopener noreferrer">Open full size</a>
      <div class="card-actions">${controls}</div>
    </div>
    <a href="${safeImageUrl}" target="_blank" rel="noopener noreferrer" class="image-link">
      <img src="${safeImageUrl}" loading="lazy" alt="${safeName}" />
    </a>
    <div class="filename" title="${safeName}">${safeName}</div>
  </article>`;
}

function renderActiveGifCard(url: string, canMutate: boolean): string {
  const safeUrl = escapeHtml(url);
  const controls = [
    canMutate
      ? '<button class="delete-button" type="button" data-delete-url="/api/discord-media?slot=private-dm" data-filename="active private-DM GIF">Delete</button>'
      : '',
    '<span class="active-badge">✓ Active DM GIF</span>',
  ].filter(Boolean).join('');

  return `<article class="image-card active-gif-card" data-image-card data-library-kind="gif" data-active-dm-gif>
    <div class="image-toolbar">
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open full size</a>
      <div class="card-actions">${controls}</div>
    </div>
    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="image-link">
      <img src="${safeUrl}" loading="lazy" alt="Active private DM GIF" />
    </a>
    <div class="filename" title="Canonical private-DM media slot">Canonical private-DM media slot</div>
  </article>`;
}

function canonicalPrivateGifUrl(tenantId: string): string {
  const relativeUrl = getDiscordMediaPublicPath('private-dm', tenantId);
  const baseUrl = getConfiguredAppUrl();
  return baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl;
}

function isCanonicalPrivateGifUrl(value: string, tenantId: string): boolean {
  const configured = String(value || '').trim();
  if (!configured) return false;
  try {
    const url = new URL(configured, getConfiguredAppUrl());
    return url.pathname === '/api/discord-media/private-dm.gif' &&
      url.searchParams.get('tenant') === tenantId;
  } catch {
    return false;
  }
}

async function resolveActivePrivateGifUrl(tenantId: string): Promise<string> {
  const configured = String(readUserConfigSync(tenantId).PRIVATE_DM_GIF_URL || '').trim();
  const canonicalUrl = canonicalPrivateGifUrl(tenantId);

  // Existing MP4 conversions used to remain hosted by DiscordStreamHub while an
  // older StreamWeaver GIF could still exist. The configured URL is what the bot
  // actually uses, so migrate that file into the tenant slot before considering
  // any older local bytes.
  if (configured && isDiscordStreamHubStoredMediaUrl(configured)) {
    try {
      await importDiscordStreamHubMedia('private-dm', configured, tenantId);
      await writeUserConfig({ PRIVATE_DM_GIF_URL: canonicalUrl }, tenantId);
      return canonicalUrl;
    } catch (error) {
      console.warn('[Private Image Library] Failed to migrate DSH active GIF into StreamWeaver:', error);
      return configured;
    }
  }

  if (configured && /^https?:\/\//i.test(configured) && !isCanonicalPrivateGifUrl(configured, tenantId)) {
    return configured;
  }

  const stored = await readTenantDiscordMedia('private-dm', tenantId).catch(() => null);
  if (stored) {
    if (configured !== canonicalUrl) {
      await writeUserConfig({ PRIVATE_DM_GIF_URL: canonicalUrl }, tenantId).catch(() => undefined);
    }
    return canonicalUrl;
  }

  return '';
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
  const canMutate = scope === 'private' && Boolean(tenantId) && session?.tenantId === tenantId;
  const gifFiles = scope === 'private' ? files.filter((filename) => /\.gif$/i.test(filename)) : [];
  const imageFiles = scope === 'private' ? files.filter((filename) => !/\.gif$/i.test(filename)) : files;
  const activePrivateGifUrl = scope === 'private' && tenantId
    ? await resolveActivePrivateGifUrl(tenantId)
    : '';
  const savedGifCount = gifFiles.length + (activePrivateGifUrl ? 1 : 0);
  const totalMediaCount = imageFiles.length + savedGifCount;

  const imageRows = imageFiles.map((filename) => renderCard({
    filename,
    tenantId,
    scope,
    canMutate,
    gif: false,
  })).join('');
  const generatedGifRows = gifFiles.map((filename) => renderCard({
    filename,
    tenantId,
    scope,
    canMutate,
    gif: true,
  })).join('');
  const gifRows = [
    activePrivateGifUrl ? renderActiveGifCard(activePrivateGifUrl, canMutate) : '',
    generatedGifRows,
  ].filter(Boolean).join('');

  const title = scope === 'private' ? 'Private Generated Media' : 'Generated Images';
  const ownerNote = scope === 'private'
    ? canMutate
      ? '<p class="note">Images and GIFs are stored separately below. The active private-DM GIF is one canonical StreamWeaver media slot, including MP4s converted by DiscordStreamHub. Delete the active slot directly, delete generated GIFs you do not want to keep, or use <strong>Apply to DM</strong> to replace it.</p>'
      : '<p class="note warning">Viewing mode. Sign in to StreamWeaver as this account in this browser to enable Delete and Apply controls.</p>'
    : '';

  const mutationScript = canMutate ? `<script>
    document.addEventListener('click', async function (event) {
      const target = event.target;
      if (!target || !target.closest) return;

      const deleteButton = target.closest('[data-delete-url]');
      if (deleteButton) {
        const filename = deleteButton.getAttribute('data-filename') || 'this media file';
        if (!window.confirm('Permanently delete ' + filename + '?')) return;
        const originalText = deleteButton.textContent;
        deleteButton.disabled = true;
        deleteButton.textContent = 'Deleting...';
        try {
          const response = await fetch(deleteButton.getAttribute('data-delete-url'), {
            method: 'DELETE',
            credentials: 'same-origin'
          });
          const payload = await response.json().catch(function () { return {}; });
          if (!response.ok) throw new Error(payload.error || ('Delete failed (' + response.status + ')'));
          const card = deleteButton.closest('[data-image-card]');
          const kind = card && card.getAttribute('data-library-kind') === 'gif' ? 'gif' : 'image';
          if (card) card.remove();
          const total = document.getElementById('media-count');
          if (total) total.textContent = String(Math.max(0, Number(total.textContent || '0') - 1));
          const kindCount = document.getElementById(kind + '-count');
          const nextKindCount = Math.max(0, Number(kindCount && kindCount.textContent ? kindCount.textContent : '0') - 1);
          if (kindCount) kindCount.textContent = String(nextKindCount);
          const gallery = document.getElementById(kind + '-gallery');
          if (gallery && nextKindCount === 0) gallery.innerHTML = '<p class="empty">Nothing saved in this section yet.</p>';
        } catch (error) {
          window.alert(error && error.message ? error.message : 'Delete failed.');
          deleteButton.disabled = false;
          deleteButton.textContent = originalText;
        }
        return;
      }

      const applyButton = target.closest('[data-apply-gif]');
      if (!applyButton) return;
      const filename = applyButton.getAttribute('data-apply-gif') || '';
      const tenantId = applyButton.getAttribute('data-tenant-id') || '';
      const buttons = Array.from(document.querySelectorAll('[data-apply-gif]'));
      applyButton.disabled = true;
      applyButton.textContent = 'Applying...';
      try {
        const response = await fetch('/api/ai/image/library', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: tenantId, scope: 'private', name: filename, action: 'apply-gif' })
        });
        const payload = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(payload.error || ('Apply failed (' + response.status + ')'));
        buttons.forEach(function (button) {
          button.disabled = false;
          button.textContent = button === applyButton ? '✓ Active DM GIF' : 'Apply to DM';
          button.classList.toggle('active', button === applyButton);
        });
        window.location.reload();
      } catch (error) {
        window.alert(error && error.message ? error.message : 'Apply failed.');
        applyButton.disabled = false;
        applyButton.textContent = 'Apply to DM';
      }
    });
  </script>` : '';

  const privateGifSection = scope === 'private' ? `
    <section class="library-section">
      <div class="section-heading">
        <div>
          <h2>Saved GIFs (<span id="gif-count">${savedGifCount}</span>)</h2>
          <p>The active DM slot appears first, followed by saved generated GIFs you can delete or apply.</p>
        </div>
      </div>
      <div id="gif-gallery" class="media-gallery">${gifRows || '<p class="empty">Nothing saved in this section yet.</p>'}</div>
    </section>` : '';

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
    h1, h2 { margin: 0 0 8px; }
    .note, .section-heading p { margin: 0; color: #c9ced8; line-height: 1.45; }
    .warning { color: #f0c674; }
    .library-section { padding-top: 24px; }
    .section-heading { display: flex; justify-content: space-between; gap: 16px; align-items: end; }
    .media-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding-top: 14px; }
    .image-card { min-width: 0; background: #1a1d24; border: 1px solid #30343c; border-radius: 12px; overflow: hidden; }
    .active-gif-card { border-color: #247a4b; }
    .image-toolbar { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; }
    .image-toolbar a { color: #9ecbff; text-decoration: none; font-size: 14px; }
    .image-toolbar a:hover { text-decoration: underline; }
    .card-actions { display: flex; gap: 7px; flex-wrap: wrap; justify-content: flex-end; }
    .delete-button, .apply-button { border: 0; border-radius: 7px; padding: 8px 11px; color: white; font-weight: 700; cursor: pointer; }
    .delete-button { background: #b4232d; }
    .apply-button { background: #2459a8; }
    .apply-button.active { background: #247a4b; }
    .active-badge { border-radius: 7px; padding: 8px 11px; color: white; background: #247a4b; font-size: 12px; font-weight: 700; }
    .delete-button:hover, .apply-button:hover { filter: brightness(1.12); }
    .delete-button:disabled, .apply-button:disabled { opacity: .65; cursor: wait; }
    .image-link { display: block; background: #090a0d; }
    img { display: block; width: 100%; height: 340px; object-fit: contain; }
    .filename { padding: 10px 12px 12px; color: #9aa2af; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .empty { color: #aeb5c0; }
    @media (max-width: 600px) {
      .page { padding: 12px; }
      .media-gallery { grid-template-columns: 1fr; }
      img { height: auto; max-height: 70vh; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <h1>${title} (<span id="media-count">${totalMediaCount}</span>)</h1>
      ${ownerNote}
    </header>
    <section class="library-section">
      <div class="section-heading">
        <div>
          <h2>${scope === 'private' ? 'Generated Images' : 'Images'} (<span id="image-count">${imageFiles.length}</span>)</h2>
          ${scope === 'private' ? '<p>Bare <strong>!img</strong> can still browse your saved media; image generation behavior is unchanged.</p>' : ''}
        </div>
      </div>
      <div id="image-gallery" class="media-gallery">${imageRows || '<p class="empty">Nothing saved in this section yet.</p>'}</div>
    </section>
    ${privateGifSection}
  </main>
  ${mutationScript}
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    tenantId?: unknown;
    scope?: unknown;
    name?: unknown;
    action?: unknown;
  } | null;
  const tenantId = String(body?.tenantId || '').trim();
  const scope = String(body?.scope || '').trim();
  const filename = String(body?.name || '').trim();
  const action = String(body?.action || '').trim();

  if (!tenantId || !isValidTenantId(tenantId)) {
    return NextResponse.json({ error: 'invalid tenantId' }, { status: 400 });
  }
  if (scope !== 'private' || action !== 'apply-gif') {
    return NextResponse.json({ error: 'Only applying a private saved GIF is supported.' }, { status: 400 });
  }
  if (!isSafePrivateGeneratedGifFilename(filename)) {
    return NextResponse.json({ error: 'invalid GIF filename' }, { status: 400 });
  }

  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return NextResponse.json({ error: 'Sign in to StreamWeaver to apply GIFs.' }, { status: 401 });
  }
  if (session.tenantId !== tenantId) {
    return NextResponse.json({ error: 'You can only apply GIFs from your own library.' }, { status: 403 });
  }

  try {
    const gif = await readPrivateGeneratedGif(tenantId, filename);
    if (!gif) return NextResponse.json({ error: 'GIF not found' }, { status: 404 });

    await writeDiscordMedia('private-dm', gif, tenantId);
    const relativeUrl = getDiscordMediaPublicPath('private-dm', tenantId);
    const baseUrl = getConfiguredAppUrl();
    const publicUrl = baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl;
    await writeUserConfig({ PRIVATE_DM_GIF_URL: publicUrl }, tenantId);
    await writePrivateChatSettings({ gifEnabled: true }, tenantId);

    return NextResponse.json({ ok: true, applied: filename, url: publicUrl, gifEnabled: true });
  } catch (error) {
    console.error('[Private Image Library] Apply GIF failed:', error);
    return NextResponse.json({ error: 'Failed to apply saved GIF.' }, { status: 500 });
  }
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
