import { NextRequest, NextResponse } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  
  if (!userId) {
    return apiError('Missing userId', { status: 400, code: 'MISSING_USER_ID' });
  }

  try {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return apiError('Discord bot token not configured', { status: 500, code: 'MISSING_CREDENTIALS' });
    }

    const response = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: {
        'Authorization': `Bot ${botToken}`
      }
    });

    if (!response.ok) {
      return apiError('User not found', { status: 404, code: 'USER_NOT_FOUND' });
    }

    const user = await response.json();
    const avatarUrl = user.avatar 
      ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png?size=512`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator) % 5}.png`;

    return apiOk({ url: avatarUrl });
  } catch (error) {
    console.error('[Discord Avatar] Error:', error);
    return apiError('Failed to fetch avatar', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
