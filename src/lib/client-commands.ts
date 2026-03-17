'use client';

import type { CommandDTO } from '@/lib/commands-store';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = (errorBody as any)?.error || response.statusText || 'Request failed';
    throw new Error(message);
  }
  return response.json();
}

export async function fetchCommands(): Promise<CommandDTO[]> {
  const res = await fetch('/api/commands', { cache: 'no-store' });
  return handleResponse<CommandDTO[]>(res);
}

export async function fetchCommandById(id: string): Promise<CommandDTO> {
  const res = await fetch(`/api/commands/${encodeURIComponent(id)}`, { cache: 'no-store' });
  return handleResponse<CommandDTO>(res);
}

export async function createCommandClient(input: { name: string; command: string; group?: string; enabled?: boolean }) {
  const res = await fetch('/api/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleResponse(res);
}

export async function updateCommandClient(
  id: string,
  input: { name?: string; command?: string; group?: string; enabled?: boolean }
) {
  const res = await fetch(`/api/commands/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleResponse(res);
}

export async function deleteCommandClient(id: string): Promise<void> {
  const res = await fetch(`/api/commands/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await handleResponse(res);
}
