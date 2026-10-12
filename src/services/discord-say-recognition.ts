export class DiscordSayRecognition {
  continuous = false; interimResults = false; lang = 'en-US';
  onstart: (() => void) | null = null; onprocessing: (() => void) | null = null;
  onresult: ((event: any) => void) | null = null; onerror: ((event: any) => void) | null = null; onend: (() => void) | null = null;
  private id = ''; private cancelled = false; private stopping = false; private started = false;
  private async request(action: string) {
    const response = await fetch('/api/say/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: this.id || undefined }), signal: AbortSignal.timeout(45_000) });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error || 'Discord voice capture failed.');
    return body.data || body;
  }
  start() {
    if (this.started) throw new Error('Voice capture already started.');
    this.started = true;
    void (async () => {
      try {
        const capture = await this.request('start'); this.id = capture.id;
        if (!this.id) throw new Error('You are no longer in Discord VC. Tap again to use your microphone.');
        if (this.cancelled) { await this.request('cancel'); return; }
        this.onstart?.();
        if (this.stopping) await this.request('stop');
        const deadline = Date.now() + 55_000;
        while (!this.cancelled && Date.now() < deadline) {
          const result = await this.request('result');
          if (this.cancelled) return;
          if (result.status === 'complete') {
            this.onprocessing?.();
            const item: any = [{ transcript: result.transcript, confidence: 1 }]; item.isFinal = true;
            this.onresult?.({ results: [item], resultIndex: 0 }); return;
          }
          if (result.status === 'error' || result.status === 'cancelled') throw new Error(result.error || 'Voice capture ended.');
          await new Promise(resolve => setTimeout(resolve, 600));
        }
        if (!this.cancelled) throw new Error('Discord voice capture timed out.');
      } catch (error) { if (!this.cancelled) this.onerror?.({ message: error instanceof Error ? error.message : String(error) }); }
      finally { if (this.id) void this.request('cancel').catch(() => {}); if (!this.cancelled) this.onend?.(); }
    })();
  }
  stop() { this.stopping = true; if (this.id) void this.request('stop').catch(error => this.onerror?.({ message: error.message })); }
  abort() { this.cancelled = true; if (this.id) void this.request('cancel').catch(() => {}); }
}
