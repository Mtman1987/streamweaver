import { NextRequest, NextResponse } from 'next/server';
import { writeVault } from '@/lib/vault-store';
import { replaceAutomationVariables } from '@/lib/automation-variables-store';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

type ImportPayloadV1 = {
  version?: number;
  vault?: unknown;
  variables?: unknown;
};

const importPayloadSchema = z
  .object({
    version: z.number().optional(),
    vault: z.record(z.unknown()).optional(),
    variables: z.record(z.unknown()).optional(),
  })
  .passthrough();

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  try {
    const parsed = importPayloadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid JSON body', { status: 400, code: 'INVALID_BODY' });
    }

    const body = parsed.data as ImportPayloadV1;

    const mode = request.nextUrl.searchParams.get('mode') || 'replace';
    if (mode !== 'replace') {
      return apiError('Only mode=replace is supported', { status: 400, code: 'INVALID_MODE' });
    }

    const vault = body.vault;
    const variables = body.variables;

    // Replace is intentionally strict-ish: we only accept object shapes.
    if (vault !== undefined) {
      await writeVault(vault as any);
    }

    if (variables !== undefined) {
      const global = isRecord((variables as any).global) ? (variables as any).global : {};
      const users = isRecord((variables as any).users) ? (variables as any).users : {};
      await replaceAutomationVariables({ global, users });
    }

    return apiOk({ ok: true });
  } catch (error: any) {
    return apiError(String(error?.message || error), { status: 500, code: 'INTERNAL_ERROR' });
  }
}
