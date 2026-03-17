import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET() {
  try {
    const tokensFile = path.join(process.cwd(), 'tokens', 'twitch-tokens.json');
    const tokensData = await fs.readFile(tokensFile, 'utf-8');
    const tokens = JSON.parse(tokensData);

    if (tokens.broadcasterToken) {
      const twitchResponse = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID!,
          'Authorization': `Bearer ${tokens.broadcasterToken}`
        }
      });

      if (twitchResponse.ok) {
        const twitchData = await twitchResponse.json();
        if (twitchData.data?.[0]) {
          return NextResponse.json({
            twitch: {
              name: twitchData.data[0].display_name,
              avatar: twitchData.data[0].profile_image_url
            }
          });
        }
      }
    }

    return NextResponse.json({});
  } catch (error) {
    return NextResponse.json({});
  }
}