import { NextResponse } from 'next/server';

export async function GET() {
  console.log('[Test] Test endpoint called successfully');
  return NextResponse.json({ 
    message: 'API routes are working correctly',
    timestamp: new Date().toISOString()
  });
}