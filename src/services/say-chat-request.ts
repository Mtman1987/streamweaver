// Short-lived response replay protection within this server process. The browser
// also sends only once per capture; this is not durable cross-machine delivery.
export function createSayChatRequestCache(ttlMs = 120_000, maxEntries = 500) {
  const entries = new Map<string, { fingerprint: string; expires: number; result: Promise<Response> }>();
  return async function once(key: string, fingerprint: string, send: () => Promise<Response>): Promise<Response> {
    for (const [id, entry] of entries) if (entry.expires <= Date.now()) entries.delete(id);
    const existing = entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Response.json({ ok: false, error: 'This speech capture was already submitted with different content.', code: 'CAPTURE_CONFLICT' }, { status: 409 });
      }
      return (await existing.result).clone();
    }
    if (entries.size >= maxEntries) {
      return Response.json({ ok: false, error: 'Speech posting is busy. Try again shortly.', code: 'CHAT_BUSY' }, { status: 503 });
    }
    const entry = { fingerprint, expires: Infinity, result: Promise.resolve().then(send) };
    entries.set(key, entry);
    try {
      return (await entry.result).clone();
    } finally {
      // Keep failures too: a failed response can follow a successful chat post.
      entry.expires = Date.now() + ttlMs;
    }
  };
}

export const runSayChatRequest = createSayChatRequestCache();
