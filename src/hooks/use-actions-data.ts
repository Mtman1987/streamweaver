'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ActionDTO } from '@/types/actions';
import { fetchActions } from '@/lib/client-actions';

export function useActionsData() {
  const [actions, setActions] = useState<ActionDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchActions();
      setActions(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load actions.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { actions, isLoading, error, refresh };
}
