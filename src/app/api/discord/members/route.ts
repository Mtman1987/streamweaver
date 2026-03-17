import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ members: [] });
    }

    const guildId = '1240832965865635881';
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return NextResponse.json({ members: [] });
    }

    const members = await response.json();
    const memberList = members.map((member: any) => ({
      id: member.user?.id,
      username: member.user?.username,
      displayName: member.nick || member.user?.display_name || member.user?.username,
      avatar: member.user?.avatar,
      joinedAt: member.joined_at,
      roles: member.roles || []
    }));

    return NextResponse.json({ members: memberList });
  } catch (error) {
    return NextResponse.json({ members: [] });
  }
}