import { NextRequest, NextResponse } from 'next/server';
import { getYouTubeService } from '@/services/youtube';
import { getMultiPlatformManager } from '@/services/multi-platform';
import { getTenantFromRequest } from '@/lib/tenant-context';

/**
 * YouTube OAuth callback handler
 */
export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId) {
      return NextResponse.redirect(new URL('/login?error=session_required', request.url));
    }
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(
        new URL(`/integrations?error=${error}`, request.url)
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL('/integrations?error=no_code', request.url)
      );
    }

    // Exchange code for tokens
    const youtubeService = getYouTubeService();
    const tokens = await youtubeService.getTokensFromCode(code);

    // Store tokens in the local tenant/token store if this flow becomes persisted
    // For now, we'll just store in memory and connect
    
    // Auto-connect to live chat
    const multiPlatform = getMultiPlatformManager();
    await multiPlatform.connectYouTube(
      tokens.access_token,
      tokens.refresh_token,
      session.tenantId,
    );

    // Redirect back to integrations page with success
    return NextResponse.redirect(
      new URL('/integrations?youtube=connected', request.url)
    );

  } catch (error) {
    console.error('YouTube callback error:', error);
    return NextResponse.redirect(
      new URL('/integrations?error=auth_failed', request.url)
    );
  }
}
