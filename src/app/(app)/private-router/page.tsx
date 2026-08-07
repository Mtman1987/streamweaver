"use client";

import { useEffect, useState } from 'react';

type PrivateMode = 'inherit' | 'eden' | 'seaart' | 'perchance' | 'pollinations';

export default function PrivateRouterPage() {
  const [privateMode, setPrivateMode] = useState<PrivateMode>('inherit');
  const [privateModel, setPrivateModel] = useState('');
  const [publicMode, setPublicMode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/gen-settings', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || 'Failed to load image settings.');
        return payload?.data || payload;
      })
      .then((settings) => {
        if (!active) return;
        setPrivateMode(settings?.privateMode || 'inherit');
        setPrivateModel(settings?.privateModel || '');
        setPublicMode(settings?.mode || 'eden');
      })
      .catch((error) => {
        if (active) setStatus(error instanceof Error ? error.message : 'Failed to load settings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus('');
    try {
      const response = await fetch('/api/gen-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privateMode, privateModel }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Failed to save private image router.');
      const saved = payload?.data || payload;
      setPrivateMode(saved?.privateMode || privateMode);
      setPrivateModel(saved?.privateModel ?? privateModel);
      setPublicMode(saved?.mode || publicMode);
      setStatus('Private DM image routing saved. Public StreamWeaver image settings were not changed.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save private image router.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Private DM Router</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the image provider used by private Discord DMs. This does not change the public StreamWeaver image provider.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading private router settings...</p>
        ) : (
          <div className="space-y-5">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              Public image provider: <strong>{publicMode || 'unknown'}</strong> (read-only here)
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium">Private DM image provider</span>
              <select
                value={privateMode}
                onChange={(event) => setPrivateMode(event.target.value as PrivateMode)}
                className="w-full rounded-md border bg-background px-3 py-2"
              >
                <option value="inherit">Same as public</option>
                <option value="eden">Eden AI</option>
                <option value="seaart">SeaArt</option>
                <option value="perchance">Perchance</option>
                <option value="pollinations">Pollinations</option>
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium">Private model override</span>
              <input
                value={privateModel}
                onChange={(event) => setPrivateModel(event.target.value)}
                placeholder="Optional; blank uses the public/default model"
                className="w-full rounded-md border bg-background px-3 py-2"
              />
            </label>

            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save private router'}
            </button>

            {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
