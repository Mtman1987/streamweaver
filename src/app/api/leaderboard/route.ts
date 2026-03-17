import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard, getUser, getUserRank } from '@/services/user-stats';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stat = searchParams.get('stat') as 'points' | 'watchtime' | 'totalCards' | 'rareCards' | 'badges' || 'totalCards';
  const username = searchParams.get('user');
  const compare = searchParams.get('compare');
  
  const leaderboard = await getLeaderboard(stat, 10);
  
  const response: Record<string, unknown> = {
    stat,
    leaderboard: leaderboard.map((u, i) => ({
      rank: i + 1,
      user: u.user,
      value: stat === 'badges' ? u.badges.length : u[stat],
      badges: u.badges,
      totalCards: u.totalCards,
      rareCards: u.rareCards
    }))
  };
  
  if (username) {
    const user = await getUser(username);
    const rank = await getUserRank(username, stat);
    response.you = {
      user: username,
      rank,
      value: stat === 'badges' ? user.badges.length : user[stat]
    };
    
    if (compare) {
      const other = await getUser(compare);
      const otherRank = await getUserRank(compare, stat);
      response.compare = {
        user: compare,
        rank: otherRank,
        value: stat === 'badges' ? other.badges.length : other[stat],
        ahead: rank < otherRank
      };
    }
  }
  
  return NextResponse.json(response);
}
