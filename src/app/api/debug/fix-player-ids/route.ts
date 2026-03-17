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
    
    if (!fs.existsSync(statsFile)) {
      return apiError('Tag stats file not found', { status: 404, code: 'NOT_FOUND' });
    }
    
    const data = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    
    // Find players with placeholder IDs (user_532000xxx)
    const playersToFix = data.players.filter((p: any) => p.id.startsWith('user_532000'));
    
    if (playersToFix.length === 0) {
      return apiOk({ message: 'No players need fixing' });
    }
    
    // Fetch real Twitch user IDs
    const usernames = playersToFix.map((p: any) => p.username);
    const response = await fetch('http://127.0.0.1:3100/api/twitch/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames })
    });
    
    if (!response.ok) {
      return apiError('Failed to fetch Twitch data', { status: 500, code: 'TWITCH_API_FAILED' });
    }
    
    const twitchData = await response.json();
    
    // Update player IDs
    playersToFix.forEach((player: any) => {
      const twitchUser = twitchData.allUsers?.find((u: any) => 
        u.username.toLowerCase() === player.username.toLowerCase()
      );
      
      if (twitchUser && twitchUser.id) {
        const playerIndex = data.players.findIndex((p: any) => p.id === player.id);
        if (playerIndex !== -1) {
          data.players[playerIndex].id = `user_${twitchUser.id}`;
          data.players[playerIndex].avatar = twitchUser.profile_image_url || '';
        }
      }
    });
    
    // Save updated data
    fs.writeFileSync(statsFile, JSON.stringify(data, null, 2));
    
    return apiOk({ 
      success: true, 
      message: `Fixed ${playersToFix.length} player IDs`,
      fixed: playersToFix.map((p: any) => p.username)
    });
  } catch (error) {
    console.error('[Debug] Failed to fix player IDs:', error);
    return apiError('Failed to update', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
