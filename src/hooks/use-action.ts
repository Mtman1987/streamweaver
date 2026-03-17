'use client';

import { useEffect, useState, useCallback } from 'react';
import type { ActionDTO } from '@/types/actions';
import { fetchActionById } from '@/lib/client-actions';

export function useAction(id: string | null) {
  const [action, setAction] = useState<ActionDTO | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchActionById(id);
      setAction(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load action.');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { action, isLoading, error, refresh };
}
