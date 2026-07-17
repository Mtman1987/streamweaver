import { NextRequest, NextResponse } from 'next/server';
import { clearPublicChatMemory } from '@/lib/public-chat-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function POST(request: NextRequest) {
  console.log('[AI Clear Memory] Manual memory clear requested');
  
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }
    await clearPublicChatMemory(session.tenantId);
    
    console.log('[AI Clear Memory] Memory successfully cleared');
    return apiOk({ 
      success: true, 
      message: 'AI chat memory has been cleared successfully' 
    });
  } catch (error) {
    console.error('[AI Clear Memory] Failed to clear memory:', error);
    return apiError('Failed to clear AI chat memory', { 
      status: 500, 
      code: 'CLEAR_MEMORY_FAILED' 
    });
  }
}

export async function GET(request: NextRequest) {
  return apiError('Method not allowed', { status: 405, code: 'METHOD_NOT_ALLOWED' });
}
