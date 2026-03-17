'use client';

import type { ActionDTO, CreateActionDTO, UpdateActionDTO } from '@/types/actions';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody?.error || response.statusText || 'Request failed';
    throw new Error(message);
  }
  return response.json();
}

export async function fetchActions(): Promise<ActionDTO[]> {
  const res = await fetch('/api/actions', { cache: 'no-store' });
  const data = await handleResponse<{ actions: ActionDTO[] }>(res);
  return data.actions;
}

export async function fetchActionById(id: string): Promise<ActionDTO> {
  const res = await fetch(`/api/actions/${id}`, { cache: 'no-store' });
  return handleResponse<ActionDTO>(res);
}

export async function createActionClient(input: CreateActionDTO): Promise<ActionDTO> {
  const res = await fetch('/api/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleResponse<ActionDTO>(res);
}

export async function updateActionClient(id: string, input: UpdateActionDTO): Promise<ActionDTO> {
  const res = await fetch(`/api/actions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleResponse<ActionDTO>(res);
}

export async function deleteActionClient(id: string): Promise<void> {
  const res = await fetch(`/api/actions/${id}`, { method: 'DELETE' });
  await handleResponse(res);
}
