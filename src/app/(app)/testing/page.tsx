"use client";

import { useState } from 'react';

type Result = { provider: string; model: string; capability: string; status: string; ms?: number; detail?: string };
type Report = { startedAt: string; finishedAt: string; testedCredentialCount: number; results: Result[]; note: string };

export default function TestingPage() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  async function runTests() {
    setRunning(true);
    setError('');
    setReport(null);
    try {
      const response = await fetch('/api/testing/free-model-candidates', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'The test run failed.');
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The test run failed.');
    } finally {
      setRunning(false);
    }
  }

  const reportText = report ? [
    'StreamWeaver focused free-model candidate test',
    'Started: ' + report.startedAt,
    'Finished: ' + report.finishedAt,
    'Configured providers tested: ' + report.testedCredentialCount,
    '',
    ...report.results.map(r => [r.provider, '|', r.model, '|', r.capability, '|', r.status, r.ms == null ? '' : '| ' + r.ms + ' ms', r.detail ? '| ' + r.detail : ''].filter(Boolean).join(' ')),
    '',
    report.note,
  ].join('\n') : '';

  async function copyReport() {
    if (!reportText) return;
    try {
      await navigator.clipboard.writeText(reportText);
    } catch {
      setError('Clipboard access failed. Select and copy the report text below.');
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Temporary diagnostic</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Free Model Candidate Test</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Tests current Gemini free-tier text and speech candidates plus OpenRouter's free-model router.
          It does not call providers already returning quota or billing errors. Secret values are never shown.
        </p>
      </header>
      <section className="rounded-xl border p-5">
        <p className="text-sm">One short prompt per candidate. Gemini uses the configured API key and may consume a small amount of its free-tier quota. OpenRouter uses its zero-priced free router.</p>
        <button type="button" onClick={runTests} disabled={running} className="mt-4 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">
          {running ? 'Testing free candidates…' : 'Test free candidates'}
        </button>
        {running ? <p className="mt-3 text-sm text-muted-foreground">Running five bounded checks. This may take up to a minute.</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      </section>
      {report ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Results — {report.results.length} checks</h2>
            <button type="button" onClick={copyReport} className="rounded-lg border px-4 py-2 text-sm font-medium">Copy results</button>
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-muted/60"><tr><th className="p-3">Provider</th><th className="p-3">Model</th><th className="p-3">Capability</th><th className="p-3">Result</th><th className="p-3">Latency</th><th className="p-3">Detail</th></tr></thead>
              <tbody>
                {report.results.map((r, i) => <tr key={r.provider + r.model + r.capability + i} className="border-t">
                  <td className="p-3">{r.provider}</td>
                  <td className="p-3 font-mono text-xs">{r.model}</td>
                  <td className="p-3">{r.capability}</td>
                  <td className="p-3 font-semibold">{r.status}</td>
                  <td className="p-3 tabular-nums">{r.ms == null ? '—' : r.ms + ' ms'}</td>
                  <td className="max-w-sm p-3 text-muted-foreground">{r.detail || 'Usable output detected'}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <label htmlFor="provider-report" className="block text-sm font-medium">Copyable report</label>
          <textarea id="provider-report" readOnly value={reportText} rows={Math.min(24, Math.max(8, report.results.length + 5))} className="w-full rounded-xl border bg-background p-3 font-mono text-xs" />
          <p className="text-xs text-muted-foreground">{report.note}</p>
        </section>
      ) : null}
    </main>
  );
}
