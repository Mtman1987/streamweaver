import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard, getUser, getUserRank } from '@/services/user-stats';
import { apiError } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }
  const ctx = { tenantId: session.tenantId, username: session.username };
  const { searchParams } = new URL(request.url);
  const stat = searchParams.get('stat') as 'points' | 'watchtime' | 'totalCards' | 'rareCards' | 'badges' || 'totalCards';
  const username = searchParams.get('user');
  const compare = searchParams.get('compare');
  
  const leaderboard = await getLeaderboard(stat, 10, ctx);
  
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
    const user = await getUser(username, ctx);
    const rank = await getUserRank(username, stat, ctx);
    response.you = {
      user: username,
      rank,
      value: stat === 'badges' ? user.badges.length : user[stat]
    };
    
    if (compare) {
      const other = await getUser(compare, ctx);
      const otherRank = await getUserRank(compare, stat, ctx);
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
