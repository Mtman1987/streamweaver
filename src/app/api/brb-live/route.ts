import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const exec = promisify(execFile);
const channelPattern = /^[a-z0-9_]{3,25}$/;
const cors = {
  'access-control-allow-origin': 'https://spmt.live',
  'cache-control': 'no-store',
};

function mediaUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.endsWith('.ttvnw.net')) {
    throw new Error('Invalid Twitch media host');
  }
  return url;
}

function proxied(url: URL): string {
  return '/api/brb-live?media=' + encodeURIComponent(url.toString());
}

function rewritePlaylist(text: string, base: URL): string {
  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      return proxied(mediaUrl(new URL(trimmed, base).toString()));
    }
    return line.replace(/URI="([^"]+)"/g, (_match, href: string) =>
      'URI="' + proxied(mediaUrl(new URL(href, base).toString())) + '"');
  }).join('\n');
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const channel = (query.get('channel') || '').trim().toLowerCase();
  const media = query.get('media');
  try {
    let url: URL;
    if (media) {
      url = mediaUrl(media);
    } else if (channelPattern.test(channel)) {
      const { stdout } = await exec('/opt/piper/bin/yt-dlp',
        ['-g', '-f', 'b', 'https://www.twitch.tv/' + channel],
        { timeout: 20000, maxBuffer: 1024 * 1024 });
      url = mediaUrl(stdout.split(/\r?\n/).find(Boolean) || '');
    } else {
      return Response.json({ error: 'Invalid channel' }, { status: 400, headers: cors });
    }
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || !response.body) {
      return Response.json({ error: 'Twitch media request failed', status: response.status },
        { status: 502, headers: cors });
    }
    const type = response.headers.get('content-type') || '';
    const playlist = url.pathname.endsWith('.m3u8') || type.includes('mpegurl');
    if (playlist) {
      const body = rewritePlaylist(await response.text(), url);
      return new Response(body, {
        headers: { ...cors, 'content-type': 'application/vnd.apple.mpegurl' },
      });
    }
    return new Response(response.body, {
      headers: {
        ...cors,
        'content-type': type || 'video/mp2t',
        ...(response.headers.get('content-length') ? { 'content-length': response.headers.get('content-length')! } : {}),
      },
    });
  } catch (error) {
    console.warn('[BRB live proof] media unavailable:', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'Live feed unavailable' }, { status: 502, headers: cors });
  }
}
