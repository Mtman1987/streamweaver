import { NextResponse } from 'next/server';

type ApiErrorOptions = {
  status?: number;
  code?: string;
  details?: unknown;
};

export function apiOk<T extends object>(payload?: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...(payload ?? {}) }, { status });
}

export function apiError(message: string, options: ApiErrorOptions = {}): NextResponse {
  const status = options.status ?? 400;
  const code = options.code ?? 'BAD_REQUEST';
  const body: Record<string, unknown> = {
    ok: false,
    error: message,
    code,
  };

  if (options.details !== undefined) {
    body.details = options.details;
  }

  return NextResponse.json(body, { status });
}
