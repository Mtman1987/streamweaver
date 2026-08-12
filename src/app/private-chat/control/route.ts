import { NextRequest, NextResponse } from 'next/server';
import {
  parsePrivateDmControlAction,
  verifyPrivateDmControlToken,
} from '@/services/private-dm-controls';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

export const dynamic = 'force-dynamic';

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

function renderError(message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private control unavailable</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#090b12;color:#f4f6ff;font-family:system-ui,sans-serif">
  <main style="max-width:34rem;padding:2rem;text-align:center">
    <div style="font-size:3rem">🔒</div>
    <h1 style="font-size:1.2rem">Private control unavailable</h1>
    <p style="color:#b7bdd1;line-height:1.5">${message}</p>
  </main>
</body>
</html>`;
}

function renderControlPage(token: string, action: 'gif' | 'adult' | 'delete'): string {
  const icon = action === 'gif' ? '🖼️' : action === 'adult' ? '🔞' : '🗑️';
  const title = action === 'gif' ? 'Private GIF' : action === 'adult' ? 'Adult Mode' : 'Delete private message';
  const initialStatus = action === 'delete'
    ? 'Tap the trash can again to delete this exact Discord message.'
    : 'Working…';
  const tokenLiteral = JSON.stringify(token);
  const actionLiteral = JSON.stringify(action);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#090b12;color:#f4f6ff;font-family:system-ui,sans-serif">
  <main style="width:min(34rem,calc(100vw - 2rem));padding:2rem;text-align:center;border:1px solid #292f43;border-radius:1rem;background:#111522;box-shadow:0 1rem 4rem rgba(0,0,0,.35)">
    <div id="icon" role="button" tabindex="0" aria-label="${title}" style="font-size:4rem;line-height:1;cursor:pointer;user-select:none">${icon}</div>
    <h1 style="font-size:1.2rem;margin:1rem 0 .5rem">${title}</h1>
    <p id="status" style="min-height:3rem;margin:0;color:#b7bdd1;line-height:1.5">${initialStatus}</p>
  </main>
  <script>
    const token = ${tokenLiteral};
    const action = ${actionLiteral};
    const status = document.getElementById('status');
    const icon = document.getElementById('icon');

    function setStatus(message) {
      status.textContent = String(message || 'Done. Return to Discord.');
    }

    async function run() {
      try {
        const response = await fetch('/api/private-chat/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ token, action }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || 'The private action failed.');
        setStatus(data.message || 'Done. Return to Discord.');
        window.setTimeout(() => { try { window.close(); } catch {} }, 900);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }

    icon.addEventListener('click', () => {
      if (action === 'delete') void run();
    });
    icon.addEventListener('keydown', (event) => {
      if (action === 'delete' && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        void run();
      }
    });

    if (action !== 'delete') void run();
  </script>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  const token = String(request.nextUrl.searchParams.get('k') || '').trim();
  const action = parsePrivateDmControlAction(request.nextUrl.searchParams.get('a'));
  const control = verifyPrivateDmControlToken(token);
  if (!control || !action) {
    return htmlResponse(renderError('This link is invalid or expired. Open a newer private bot reply and use its icon strip.'), 401);
  }

  if (action === 'settings') {
    const settingsUrl = new URL('/private-chat', getConfiguredAppUrl());
    return NextResponse.redirect(settingsUrl);
  }

  if (action === 'tts') {
    const playerUrl = new URL('/private-chat/tts', getConfiguredAppUrl());
    playerUrl.searchParams.set('k', token);
    return NextResponse.redirect(playerUrl);
  }

  return htmlResponse(renderControlPage(token, action));
}
