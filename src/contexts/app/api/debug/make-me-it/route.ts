import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { isDebugRoutesEnabled } from '@/lib/local-config/service';
import { apiError, apiOk } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  if (!(await isDebugRoutesEnabled())) {
    return apiError('Debug routes are disabled', { status: 403, code: 'DEBUG_DISABLED' });
  }

  try {
    const statsFile = path.join(process.cwd(), 'data', 'tag-stats.json');
    const data = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    
    const mtman = data.players.find((p: any) => p.username.toLowerCase() === 'mtman1987');
    if (!mtman) {
      return apiError('mtman1987 not found', { status: 404, code: 'NOT_FOUND' });
    }
    
    data.currentIt = mtman.id;
    data.immunity = {};
    data.lastUpdate = Date.now();
    fs.writeFileSync(statsFile, JSON.stringify(data, null, 2));
    
    return apiOk({ success: true });
  } catch (error) {
    return apiError('Failed', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function PUT(request: NextRequest) {
  if (!(await isDebugRoutesEnabled())) {
    return apiError('Debug routes are disabled', { status: 403, code: 'DEBUG_DISABLED' });
  }

  try {
    const statsFile = path.join(process.cwd(), 'data', 'tag-stats.json');
    
    let data;
    try {
      data = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    } catch (fileError: any) {
      console.error('[Trigger Timeout] File read error:', fileError.message);
      return apiError('Failed to read files: ' + fileError.message, { status: 500, code: 'INTERNAL_ERROR' });
    }
    
    const currentIt = data.players.find((p: any) => p.id === data.currentIt);
    
    // Set player as offline/away with immunity
    if (currentIt && !data.immunity) data.immunity = {};
    if (currentIt) {
      data.immunity[`${currentIt.id}_offline`] = true;
    }
    
    // Set to FREE FOR ALL mode
    data.currentIt = null;
    data.lastUpdate = Date.now();
    data.tags.push({
      from: 'system',
      to: 'free-for-all',
      timestamp: Date.now(),
      channel: 'manual-timeout'
    });
    
    fs.writeFileSync(statsFile, JSON.stringify(data, null, 2));
    
    const announcement = `🔥 FREE FOR ALL! ${currentIt?.username || 'Someone'} timed out. Anyone can tag for DOUBLE POINTS! 🔥`;
    
    try {
      await fetch('http://127.0.0.1:8090/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'tag-announcement', message: announcement })
      });
    } catch (err) {
      console.error('[Trigger Timeout] Broadcast failed:', err);
    }
    
    return apiOk({ success: true, previousIt: currentIt?.username, announcement });
  } catch (error: any) {
    console.error('[Trigger Timeout] Error:', error.message);
    return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
  }
}
