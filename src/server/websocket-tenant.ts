export type TenantSocketAction =
  | { ok: true; tenantId: string }
  | { ok: false; error: string };

export function resolveTenantSocketAction(tenantId: unknown, action: string): TenantSocketAction {
  const normalized = typeof tenantId === 'string' ? tenantId.trim() : '';
  if (!normalized) return { ok: false, error: `Missing tenant context for ${action}` };
  return { ok: true, tenantId: normalized };
}
