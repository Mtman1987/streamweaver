import { NextRequest, NextResponse } from 'next/server';
import { clearPublicChatMemory } from '@/lib/public-chat-store';
import { apiError, apiOk } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  console.log('[AI Clear Memory] Manual memory clear requested');
  
  try {
    await clearPublicChatMemory();
    
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
  // Allow GET requests for easy testing/emergency clearing
  return POST(request);
}