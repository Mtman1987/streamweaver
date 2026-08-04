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
  visualTuning: VisualTuning;
  setVisualTuning: (value: VisualTuning) => Promise<void>;
};

export type VisualTuning = {
  glowStrength: number;
  surfaceOpacity: number;
  uiScale: number;
};

const DEFAULT_VISUAL_TUNING: VisualTuning = {
  glowStrength: 100,
  surfaceOpacity: 100,
  uiScale: 100,
};

const WORKSPACE_REFRESH_MS = 30_000;
const WorkspaceThemeContext = React.createContext<WorkspaceThemeContextValue | null>(null);

export function WorkspaceThemeProvider({ children }: { children: React.ReactNode }) {
  const persisted = useSpmtAppState('ui-preferences', {
    followWorkspaceTheme: true,
    visualTuning: DEFAULT_VISUAL_TUNING,
  });
  const [followWorkspaceTheme, setFollowState] = React.useState(true);
  const [visualTuning, setVisualTuningState] = React.useState(DEFAULT_VISUAL_TUNING);
  const [status, setStatus] = React.useState<WorkspaceThemeContextValue['status']>('loading');
  const [error, setError] = React.useState('');
  const [reconnectUrl, setReconnectUrl] = React.useState('');
  const tuningHydratedRef = React.useRef(false);
  const revisionRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!persisted.loaded) return;
    tuningHydratedRef.current = false;
    setFollowState(persisted.value.followWorkspaceTheme !== false);
    setVisualTuningState({ ...DEFAULT_VISUAL_TUNING, ...(persisted.value.visualTuning || {}) });
  }, [persisted.loaded, persisted.value.followWorkspaceTheme, persisted.value.visualTuning]);

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--app-glow-strength', String(visualTuning.glowStrength / 100));
    root.style.setProperty('--app-surface-opacity', String(visualTuning.surfaceOpacity / 100));
    root.style.setProperty('--app-ui-scale', String(visualTuning.uiScale / 100));
  }, [visualTuning]);

  React.useEffect(() => {
    if (!persisted.loaded) return;
    if (!tuningHydratedRef.current) {
      tuningHydratedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      void persisted.save({ followWorkspaceTheme, visualTuning })
        .catch((saveError) => {
          setStatus('error');
          setError(saveError instanceof Error ? saveError.message : 'Visual tuning could not be saved');
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [followWorkspaceTheme, persisted.loaded, persisted.save, visualTuning]);

  const loadWorkspaceTheme = React.useCallback(async (quiet = false) => {
    if (!followWorkspaceTheme) {
      clearWorkspaceThemeTokens(document.documentElement);
      revisionRef.current = null;
      setStatus('local');
      setError('');
      setReconnectUrl('');
      return;
    }
    if (!quiet) setStatus('loading');
    setError('');
    setReconnectUrl('');
    try {
      const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.tokens) {
        if (body?.reconnectUrl) setReconnectUrl(String(body.reconnectUrl));
        throw new Error(body?.error || 'Workspace theme unavailable');
      }
      const revision = Number(body.revision || 0);
      if (revisionRef.current !== revision || !document.documentElement.dataset.workspaceTheme) {
        applyWorkspaceThemeTokens(document.documentElement, body.tokens as WorkspaceThemeTokensV1);
        revisionRef.current = revision;
        window.dispatchEvent(new CustomEvent('spmt-workspace-updated', { detail: body }));
      }
      setStatus('applied');
    } catch (themeError) {
      if (!quiet || !document.documentElement.dataset.workspaceTheme) {
        clearWorkspaceThemeTokens(document.documentElement);
        setStatus('error');
      }
      setError(themeError instanceof Error ? themeError.message : 'Workspace theme unavailable');
    }
  }, [followWorkspaceTheme]);

  React.useEffect(() => {
    if (!persisted.loaded) return;
    void loadWorkspaceTheme();
    const interval = window.setInterval(() => void loadWorkspaceTheme(true), WORKSPACE_REFRESH_MS);
    const onFocus = () => void loadWorkspaceTheme(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadWorkspaceTheme(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [persisted.loaded, loadWorkspaceTheme]);

  const setFollowWorkspaceTheme = React.useCallback(async (next: boolean) => {
    const previous = followWorkspaceTheme;
    setFollowState(next);
    setStatus('saving');
    setError('');
    try {
      await persisted.save({ followWorkspaceTheme: next, visualTuning });
      if (!next) {
        clearWorkspaceThemeTokens(document.documentElement);
        revisionRef.current = null;
        setStatus('local');
      }
    } catch (saveError) {
      setFollowState(previous);
      setStatus('error');
      setError(saveError instanceof Error ? saveError.message : 'Theme preference could not be saved');
    }
  }, [followWorkspaceTheme, persisted, visualTuning]);

  const setVisualTuning = React.useCallback(async (next: VisualTuning) => {
    const normalized = {
      glowStrength: Math.max(40, Math.min(160, Math.round(next.glowStrength))),
      surfaceOpacity: Math.max(45, Math.min(125, Math.round(next.surfaceOpacity))),
      uiScale: Math.max(85, Math.min(115, Math.round(next.uiScale))),
    };
    setVisualTuningState(normalized);
  }, []);

  const value = React.useMemo<WorkspaceThemeContextValue>(() => ({
    followWorkspaceTheme,
    setFollowWorkspaceTheme,
    status,
    error,
    reconnectUrl,
    retry: () => loadWorkspaceTheme(false),
    accountBacked: persisted.accountBacked,
    visualTuning,
    setVisualTuning,
  }), [error, followWorkspaceTheme, loadWorkspaceTheme, persisted.accountBacked, reconnectUrl, setFollowWorkspaceTheme, setVisualTuning, status, visualTuning]);

  return <WorkspaceThemeContext.Provider value={value}>{children}</WorkspaceThemeContext.Provider>;
}

export function useWorkspaceTheme() {
  const value = React.useContext(WorkspaceThemeContext);
  if (!value) throw new Error('useWorkspaceTheme must be used inside WorkspaceThemeProvider');
  return value;
}
