import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

let cachedUrl: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function GET() {
  if (cachedUrl && Date.now() - cacheTime < CACHE_TTL) {
    return NextResponse.redirect(cachedUrl);
  }

  try {
    const tokensPath = path.join(process.cwd(), 'tokens', 'twitch-tokens.json');
    if (!fs.existsSync(tokensPath)) return fallback();
    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));

    const token = tokens.broadcasterToken || tokens.loginToken;
    const username = tokens.broadcasterUsername || tokens.loginUsername;
    if (!token || !username) return fallback();

    const clientId = process.env.TWITCH_CLIENT_ID;
    if (!clientId) return fallback();

    const resp = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': clientId },
    });
    if (!resp.ok) return fallback();

    const data = await resp.json() as any;
    const url = data.data?.[0]?.profile_image_url;
    if (!url) return fallback();

    cachedUrl = url;
    cacheTime = Date.now();
    return NextResponse.redirect(url);
  } catch {
    return fallback();
  }
}

function fallback() {
  return new NextResponse(null, { status: 404 });
}
