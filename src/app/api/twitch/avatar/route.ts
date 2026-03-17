import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  let username = 'broadcaster';
  try {
    const tokensPath = path.join(process.cwd(), 'tokens', 'twitch-tokens.json');
    if (fs.existsSync(tokensPath)) {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      if (tokens.broadcasterUsername) username = tokens.broadcasterUsername;
    }
  } catch {}

  return NextResponse.redirect(
    `https://static-cdn.jtvnw.net/jtv_user_pictures/${username}-profile_image-300x300.png`
  );
}
