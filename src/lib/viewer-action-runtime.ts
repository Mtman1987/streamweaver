import type { ViewerActionPrompt } from './viewer-action-prompts';

type PendingPrompt = {
  text: string;
  options: string[];
  createdAt: number;
};

const MAX_AGE_MS = 60_000;

function store(): Map<string, PendingPrompt> {
  const g = globalThis as any;
  if (!g.__streamweaver_pending_viewer_action_prompts) {
    g.__streamweaver_pending_viewer_action_prompts = new Map<string, PendingPrompt>();
  }
  return g.__streamweaver_pending_viewer_action_prompts;
}

function key(tenantId?: string): string {
  return String(tenantId || 'global');
}

function normalize(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function rememberViewerActionPrompt(
  tenantId: string | undefined,
  text: string,
  options: string[],
): void {
  store().set(key(tenantId), {
    text: normalize(text),
    options: options.slice(0, 5),
    createdAt: Date.now(),
  });
}

export function consumeViewerActionPrompt(
  tenantId: string | undefined,
  text: string,
): ViewerActionPrompt | undefined {
  const pending = store().get(key(tenantId));
  if (!pending) return undefined;
  if (Date.now() - pending.createdAt > MAX_AGE_MS) {
    store().delete(key(tenantId));
    return undefined;
  }
  if (pending.text !== normalize(text)) return undefined;
  store().delete(key(tenantId));
  return {
    id: crypto.randomUUID(),
    question: normalize(text).slice(0, 500),
    options: pending.options,
    expiresAt: new Date(Date.now() + 45_000).toISOString(),
  };
}
