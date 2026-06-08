import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { readDashboardActivity } from '@/lib/dashboard-activity-store';
import { readPublicChatMessages } from '@/lib/public-chat-store';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { loadChatHistory } from '@/services/chat-monitor';

function classifyEvent(message: string): string | null {
  const text = message.toLowerCase();
  if (/\braid(ed|ing)?\b/.test(text)) return 'Raid';
  if (/\b(cheer|bits?)\b/.test(text)) return 'Bits';
  if (/\b(gifted|gift sub|gifted sub)\b/.test(text)) return 'Gift sub';
  if (/\b(resub|subscribed|subscription|subscriber)\b/.test(text)) return 'Sub';
  if (/\b(followed|new follower|following)\b/.test(text)) return 'Follow';
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }

    const liveActivity = readDashboardActivity(session.tenantId, 50);
    let messages = liveActivity.map((entry) => ({
      id: entry.id,
      user: entry.user,
      message: entry.message,
      color: entry.color,
      platform: entry.platform,
      isSystemMessage: false,
      timestamp: entry.timestamp,
    }));

    if (messages.length === 0) {
      const history = await loadChatHistory(session.tenantId);
      messages = history.slice(-30).map((entry) => ({
        id: entry.id,
        user: entry.user,
        message: entry.message,
        color: entry.color,
        platform: entry.user.toLowerCase().includes('[discord]') ? 'Discord' : 'Twitch',
        isSystemMessage: entry.isSystemMessage,
        timestamp: new Date().toISOString(),
      }));
    }

    if (messages.length === 0) {
      const publicHistory = await readPublicChatMessages(30, session.tenantId);
      messages = publicHistory.map((entry, index) => ({
        id: `public-${entry.timestamp}-${index}`,
        user: entry.username,
        message: entry.message,
        color: undefined,
        platform: entry.type === 'ai' ? 'System' : 'Twitch',
        isSystemMessage: entry.type === 'ai',
        timestamp: entry.timestamp,
      }));
    }

    const events = messages
      .map((entry) => {
        const type = classifyEvent(`${entry.user} ${entry.message}`);
        if (!type) return null;
        return {
          id: `event-${entry.id}`,
          type,
          actor: entry.user.replace(/^\[(Twitch|Discord)\]\s*/i, ''),
          detail: entry.message,
          platform: entry.platform,
        };
      })
      .filter(Boolean)
      .slice(-12);

    return apiOk({ messages, events });
  } catch (error) {
    console.error('[Dashboard Activity] Failed:', error);
    return apiError('Failed to load dashboard activity', { status: 500, code: 'DASHBOARD_ACTIVITY_FAILED' });
  }
}
