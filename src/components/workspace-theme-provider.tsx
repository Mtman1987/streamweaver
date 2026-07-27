'use client';

import * as React from 'react';
import type { WorkspaceThemeTokensV1 } from '@spmt/sdk';
import { useSpmtAppState } from '@/hooks/use-spmt-app-state';
import { applyWorkspaceThemeTokens, clearWorkspaceThemeTokens } from '@/lib/workspace-theme';

type WorkspaceThemeContextValue = {
  followWorkspaceTheme: boolean;
  setFollowWorkspaceTheme: (value: boolean) => Promise<void>;
  status: 'loading' | 'applied' | 'local' | 'saving' | 'error';
  error: string;
  reconnectUrl: string;
  retry: () => Promise<void>;
  accountBacked: boolean;
};

const WorkspaceThemeContext = React.createContext<WorkspaceThemeContextValue | null>(null);

export function WorkspaceThemeProvider({ children }: { children: React.ReactNode }) {
  const persisted = useSpmtAppState('ui-preferences', { followWorkspaceTheme: true });
  const [followWorkspaceTheme, setFollowState] = React.useState(true);
  const [status, setStatus] = React.useState<WorkspaceThemeContextValue['status']>('loading');
  const [error, setError] = React.useState('');
  const [reconnectUrl, setReconnectUrl] = React.useState('');

  React.useEffect(() => {
    if (!persisted.loaded) return;
    setFollowState(persisted.value.followWorkspaceTheme !== false);
  }, [persisted.loaded, persisted.value.followWorkspaceTheme]);

  const loadWorkspaceTheme = React.useCallback(async () => {
    if (!followWorkspaceTheme) {
      clearWorkspaceThemeTokens(document.documentElement);
      setStatus('local');
      setError('');
      setReconnectUrl('');
      return;
    }
    setStatus('loading');
    setError('');
    setReconnectUrl('');
    try {
      const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.tokens) {
        if (body?.reconnectUrl) setReconnectUrl(String(body.reconnectUrl));
        throw new Error(body?.error || 'Workspace theme unavailable');
      }
      applyWorkspaceThemeTokens(document.documentElement, body.tokens as WorkspaceThemeTokensV1);
      setStatus('applied');
    } catch (themeError) {
      clearWorkspaceThemeTokens(document.documentElement);
      setStatus('error');
      setError(themeError instanceof Error ? themeError.message : 'Workspace theme unavailable');
    }
  }, [followWorkspaceTheme]);

  React.useEffect(() => {
    if (!persisted.loaded) return;
    void loadWorkspaceTheme();
  }, [persisted.loaded, loadWorkspaceTheme]);

  const setFollowWorkspaceTheme = React.useCallback(async (next: boolean) => {
    const previous = followWorkspaceTheme;
    setFollowState(next);
    setStatus('saving');
    setError('');
    try {
      await persisted.save({ followWorkspaceTheme: next });
      if (!next) {
        clearWorkspaceThemeTokens(document.documentElement);
        setStatus('local');
      }
    } catch (saveError) {
      setFollowState(previous);
      setStatus('error');
      setError(saveError instanceof Error ? saveError.message : 'Theme preference could not be saved');
    }
  }, [followWorkspaceTheme, persisted]);

  const value = React.useMemo<WorkspaceThemeContextValue>(() => ({
    followWorkspaceTheme,
    setFollowWorkspaceTheme,
    status,
    error,
    reconnectUrl,
    retry: loadWorkspaceTheme,
    accountBacked: persisted.accountBacked,
  }), [error, followWorkspaceTheme, loadWorkspaceTheme, persisted.accountBacked, reconnectUrl, setFollowWorkspaceTheme, status]);

  return <WorkspaceThemeContext.Provider value={value}>{children}</WorkspaceThemeContext.Provider>;
}

export function useWorkspaceTheme() {
  const value = React.useContext(WorkspaceThemeContext);
  if (!value) throw new Error('useWorkspaceTheme must be used inside WorkspaceThemeProvider');
  return value;
}
