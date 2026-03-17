'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CommandDTO } from '@/lib/commands-store';
import { fetchCommands } from '@/lib/client-commands';

export function useCommandsData() {
  const [commands, setCommands] = useState<CommandDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchCommands();
      setCommands(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load commands.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { commands, isLoading, error, refresh };
}
