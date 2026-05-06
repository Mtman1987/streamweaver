import { NextRequest, NextResponse } from 'next/server';
import {
  deleteGlobalVariable,
  deleteUserVariable,
  listGlobalVariables,
  listUserVariables,
  replaceGlobalVariables,
  replaceUserVariables,
  setGlobalVariable,
  setUserVariable,
} from '@/lib/automation-variables-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

type Scope = 'global' | 'user';

const scopeSchema = z.enum(['global', 'user']);
const putVariablesSchema = z.object({
  scope: scopeSchema,
  user: z.string().trim().optional(),
  variables: z.record(z.unknown()).optional(),
  key: z.string().trim().optional(),
  value: z.unknown().optional(),
});

const deleteVariablesSchema = z.object({
  scope: scopeSchema,
  user: z.string().trim().optional(),
  key: z.string().trim().min(1),
});

function getScopeFromUrl(request: NextRequest): Scope | null {
  const scope = request.nextUrl.searchParams.get('scope');
  if (scope === 'global' || scope === 'user') return scope;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const tenantId = session?.tenantId;
    const scope = getScopeFromUrl(request);
    if (!scope) {
      return apiError('Missing or invalid scope (global|user)', { status: 400, code: 'INVALID_QUERY' });
    }

    if (scope === 'global') {
      const variables = await listGlobalVariables(tenantId);
      return apiOk({ scope, variables });
    }

    const user = request.nextUrl.searchParams.get('user');
    if (!user) {
      return apiError('Missing user for scope=user', { status: 400, code: 'INVALID_QUERY' });
    }
    const variables = await listUserVariables(user, tenantId);
    return apiOk({ scope, user, variables });
  } catch (error: any) {
    return apiError(String(error?.message || error), { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const tenantId = session?.tenantId;
    const parsed = putVariablesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid JSON body', { status: 400, code: 'INVALID_BODY' });
    }

    const body = parsed.data;
    const scope = body.scope as Scope;

    // Bulk replace
    if (body.variables !== undefined) {
      if (scope === 'global') {
        await replaceGlobalVariables(body.variables as Record<string, unknown>, tenantId);
        return apiOk({ scope, variables: await listGlobalVariables(tenantId) });
      }
      const user = typeof body.user === 'string' ? body.user : '';
      if (!user.trim()) {
        return apiError('Missing user for scope=user', { status: 400, code: 'INVALID_BODY' });
      }
      await replaceUserVariables(user, body.variables as Record<string, unknown>, tenantId);
      return apiOk({ scope, user, variables: await listUserVariables(user, tenantId) });
    }

    // Single key set
    const key = typeof body.key === 'string' ? body.key : '';
    if (!key.trim()) {
      return apiError('Missing key', { status: 400, code: 'INVALID_BODY' });
    }
    const value = (body as any).value;

    if (scope === 'global') {
      await setGlobalVariable(key, value, tenantId);
      return apiOk({ scope, variables: await listGlobalVariables(tenantId) });
    }

    const user = typeof body.user === 'string' ? body.user : '';
    if (!user.trim()) {
      return apiError('Missing user for scope=user', { status: 400, code: 'INVALID_BODY' });
    }
    await setUserVariable(user, key, value, tenantId);
    return apiOk({ scope, user, variables: await listUserVariables(user, tenantId) });
  } catch (error: any) {
    return apiError(String(error?.message || error), { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const tenantId = session?.tenantId;
    const parsed = deleteVariablesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid JSON body', { status: 400, code: 'INVALID_BODY' });
    }

    const { scope, key, user } = parsed.data;

    if (scope === 'global') {
      await deleteGlobalVariable(key, tenantId);
      return apiOk({ scope, variables: await listGlobalVariables(tenantId) });
    }

    if (!user?.trim()) {
      return apiError('Missing user for scope=user', { status: 400, code: 'INVALID_BODY' });
    }
    await deleteUserVariable(user, key, tenantId);
    return apiOk({ scope, user, variables: await listUserVariables(user, tenantId) });
  } catch (error: any) {
    return apiError(String(error?.message || error), { status: 500, code: 'INTERNAL_ERROR' });
  }
}
