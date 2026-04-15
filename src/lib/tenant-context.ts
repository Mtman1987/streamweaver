import { NextRequest } from 'next/server';
import type { StorageContext } from '@/services/storage';

export interface TenantSession {
  tenantId: string;
  username: string;
  displayName?: string;
  avatar?: string;
}

export function getTenantFromRequest(request: NextRequest): TenantSession | null {
  const cookie = request.cookies.get('streamweaver-session')?.value;
  if (!cookie) return null;
  try {
    const session = JSON.parse(cookie);
    if (!session.id || !session.username) return null;
    return {
      tenantId: session.id,
      username: session.username,
      displayName: session.displayName,
      avatar: session.avatar,
    };
  } catch {
    return null;
  }
}

export function toStorageContext(session: TenantSession): StorageContext {
  return { tenantId: session.tenantId, username: session.username };
}
