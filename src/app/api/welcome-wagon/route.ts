import { NextRequest, NextResponse } from 'next/server';
import { addExcludedUser, removeExcludedUser, getExcludedUsers } from '../../../services/welcome-wagon-tracker';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const welcomeActionSchema = z.object({
  username: z.string().trim().min(1).max(64),
  action: z.enum(['add', 'remove']),
});

export async function GET(request: NextRequest) {
  try {
    const excludedUsers = await getExcludedUsers();
    return apiOk({ excludedUsers });
  } catch (error) {
    return apiError('Failed to get excluded users', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = welcomeActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Username and action required', { status: 400, code: 'INVALID_BODY' });
    }

    const { username, action } = parsed.data;
    
    if (action === 'add') {
      await addExcludedUser(username);
      return apiOk({ message: `Added ${username} to excluded list` });
    }

    if (action === 'remove') {
      await removeExcludedUser(username);
      return apiOk({ message: `Removed ${username} from excluded list` });
    }

    return apiError('Invalid action', { status: 400, code: 'INVALID_BODY' });
  } catch (error) {
    return apiError('Failed to update excluded users', { status: 500, code: 'INTERNAL_ERROR' });
  }
}