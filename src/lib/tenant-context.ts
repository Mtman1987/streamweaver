import { NextRequest } from 'next/server';
import type { StorageContext } from '@/services/storage';
import { parseSessionCookie } from '@/lib/session-cookie';

export interface TenantSession {
  tenantId: string;
  username: string;
  displayName?: string;
  avatar?: string;
}

export function getTenantFromRequest(request: NextRequest): TenantSession | null {
  const cookie = request.cookies.get('streamweaver-session')?.value;
  if (!cookie) return null;
  const session = parseSessionCookie(cookie);
  if (!session) return null;
  return {
    tenantId: session.id,
    username: session.username,
    displayName: session.displayName,
    avatar: session.avatar,
  };
}

export function toStorageContext(session: TenantSession): StorageContext {
  return { tenantId: session.tenantId, username: session.username };
}
