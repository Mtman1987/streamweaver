export type MtCodexJobRequest = {
  source: 'twitch' | 'discord';
  tenantId?: string;
  reporter: string;
  reporterId?: string;
  channelId?: string;
  description: string;
  triggerMessage: string;
  context?: Record<string, unknown>;
};

export type MtCodexJobResult = {
  ok: boolean;
  jobId?: string;
  dashboardUrl?: string;
  error?: string;
};

export async function createMtCodexJob(input: MtCodexJobRequest): Promise<MtCodexJobResult> {
  const baseUrl = String(process.env.SPMT_CODEX_API_URL || 'https://spmt.live').trim();
  const spmtApiKey = String(process.env.SPMT_API_KEY || '').trim();
  if (!spmtApiKey) {
    return {
      ok: false,
      error: 'SPMT_API_KEY is not configured for the Athena Codex bridge.',
    };
  }

  try {
    const response = await fetch(new URL('/api/athena/code-jobs', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        // SPMT uses the existing API key as the server-to-server Athena credential.
        // The custom header keeps it separate from user/admin bearer sessions.
        'x-spmt-codex-secret': spmtApiKey,
      },
      body: JSON.stringify({
        source: `streamweaver:${input.source}`,
        tenantId: input.tenantId,
        reporter: input.reporter,
        reporterId: input.reporterId,
        description: input.description,
        context: {
          channelId: input.channelId,
          triggerMessage: input.triggerMessage,
          ...(input.context || {}),
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      return {
        ok: false,
        error: String(payload.error || `SPMT returned ${response.status}`),
      };
    }
    return {
      ok: true,
      jobId: String(payload.job?.id || ''),
      dashboardUrl: String(
        payload.dashboardUrl ||
        process.env.CODEX_REPAIR_DASHBOARD_URL ||
        'https://mtman-machine-rotator.fly.dev/athena',
      ),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
