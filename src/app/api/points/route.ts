import { NextRequest, NextResponse } from 'next/server';
import { getPoints, addPoints, setPoints, getLeaderboard, addPointsToAll, setPointsToAll, resetAllPoints } from '@/services/points';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const pointsQuerySchema = z.object({
  action: z.enum(['leaderboard', 'get']),
  userId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});

const pointsBodySchema = z
  .object({
    action: z.enum(['add', 'set', 'addToAll', 'setToAll', 'resetAll']).optional(),
    userId: z.string().trim().min(1).optional(),
    target: z.string().trim().min(1).optional(),
    username: z.string().trim().min(1).optional(),
    amount: z.number().finite().optional(),
    value: z.number().finite().optional(),
    points: z.number().finite().optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .passthrough();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = pointsQuerySchema.safeParse({
    action: searchParams.get('action'),
    userId: searchParams.get('userId') || undefined,
    limit: searchParams.get('limit') || undefined,
  });

  if (!parsed.success) {
    return apiError('Invalid action or missing parameters', { status: 400, code: 'INVALID_QUERY' });
  }

  const { action, userId, limit } = parsed.data;

  try {
    if (action === 'leaderboard') {
      const leaderboard = await getLeaderboard(limit);
      return apiOk({ leaderboard });
    }

    if (action === 'get' && userId) {
      const userPoints = await getPoints(userId);
      return apiOk({ userId, ...userPoints });
    }

    return apiError('Invalid action or missing parameters', { status: 400, code: 'INVALID_QUERY' });
  } catch (error) {
    console.error('Points API error:', error);
    return apiError('Internal server error', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = pointsBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { action, userId, amount, value, username, points, reason, target } = parsed.data;

    // Backwards-compatible: accept { username, points } payloads from UI
    if (!action && username && typeof points === 'number') {
      const result = await addPoints(username, points, reason || 'ui action');
      return apiOk({ userId: username, ...result });
    }

    if (action === 'add') {
      const targetUser = target || userId;
      if (!targetUser || typeof amount !== 'number') {
        return apiError('userId/target and amount required', { status: 400, code: 'INVALID_BODY' });
      }
      const result = await addPoints(targetUser, amount, 'manual add');
      return apiOk({ userId: targetUser, ...result });
    }

    if (action === 'set') {
      const targetUser = target || userId;
      if (!targetUser || typeof value !== 'number') {
        return apiError('userId/target and value required', { status: 400, code: 'INVALID_BODY' });
      }
      const result = await setPoints(targetUser, value);
      return apiOk({ userId: targetUser, ...result });
    }

    if (action === 'addToAll') {
      if (typeof amount !== 'number') {
        return apiError('amount required', { status: 400, code: 'INVALID_BODY' });
      }
      const count = await addPointsToAll(amount);
      return apiOk({ count, amount });
    }

    if (action === 'setToAll') {
      if (typeof amount !== 'number') {
        return apiError('amount required', { status: 400, code: 'INVALID_BODY' });
      }
      const count = await setPointsToAll(amount);
      return apiOk({ count, amount });
    }

    if (action === 'resetAll') {
      const count = await resetAllPoints();
      return apiOk({ count });
    }

    return apiError('Invalid action', { status: 400, code: 'INVALID_ACTION' });
  } catch (error) {
    console.error('Points API error:', error);
    return apiError('Internal server error', { status: 500, code: 'INTERNAL_ERROR' });
  }
}