import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readAllTenantShoutoutAuditText, readShoutoutAuditText } from '@/services/shoutout-audit';

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'all';
}

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session) {
      return apiError('Login required', { status: 401, code: 'UNAUTHORIZED' });
    }

    const url = new URL(request.url);
    const requestedTenantId = url.searchParams.get('tenantId')?.trim() || 'all';
    const readAll = requestedTenantId === 'all';
    const tenantId = readAll ? 'all' : requestedTenantId || session.tenantId;
    const username = url.searchParams.get('username')?.trim().replace(/^@/, '') || undefined;
    const text = readAll
      ? await readAllTenantShoutoutAuditText(username)
      : await readShoutoutAuditText(tenantId, username);
    const scope = username ? safeFilePart(username.toLowerCase()) : 'all';
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="shoutout-audit-${scope}-${date}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[shoutout-audit/download] Error:', error);
    return apiError(error instanceof Error ? error.message : 'Failed to download shoutout audit', {
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  }
}
