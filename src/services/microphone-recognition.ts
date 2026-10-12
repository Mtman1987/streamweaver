import { captureMicrophone, microphoneBlobToBase64 } from './microphone-capture';

export class MicrophoneRecognition {
  continuous = false;
  interimResults = false;
  lang = 'en-US';
  silenceTimeoutMs = 0;
  readonly microphoneOnly = true;
  onstart: (() => void) | null = null;
  onprocessing: (() => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  private capture: ReturnType<typeof captureMicrophone> | null = null;
  private aborted = false;
  private busy = false;
  private request: AbortController | null = null;

  start() {
    if (this.busy) throw new Error('Microphone recording is already in progress.');
    this.busy = true; this.aborted = false;
    this.capture = captureMicrophone({
      silenceTimeoutMs: this.silenceTimeoutMs,
      ready: () => { if (!this.aborted) this.onstart?.(); },
    });
    void this.capture.finished.then(async blob => {
      if (this.aborted) return;
      this.onprocessing?.();
      const base64Audio = await microphoneBlobToBase64(blob);
      if (this.aborted) return;
      this.request = new AbortController();
      const timer = setTimeout(() => this.request?.abort(), 25000);
      let response: Response;
      try {
        response = await fetch('/api/speech/transcribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Audio, freeOnly: true }),
          signal: this.request.signal,
        });
      } finally { clearTimeout(timer); }
      const body = await response.json().catch(() => ({}));
      const data = body.data || body;
      if (!response.ok || data.error) throw new Error(data.error || body.error || 'Microphone transcription is unavailable. Try again shortly or type your message.');
      const transcript = String(data.transcription || '').trim();
      if (!transcript) throw new Error('No spoken words were found in the microphone recording. Try again or type your message.');
      if (this.aborted) return;
      const result: any = [{ transcript, confidence: 1 }];
      result.isFinal = true;
      this.onresult?.({ resultIndex: 0, results: [result] });
    }).catch(error => {
      if (!this.aborted) this.onerror?.({ error: 'microphone-capture', message: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      this.capture = null; this.request = null; this.busy = false;
      if (!this.aborted) this.onend?.();
    });
  }
  stop() { this.capture?.stop(); }
  abort() { this.aborted = true; this.request?.abort(); this.capture?.cancel(); }
}

// Mobile uses a bounded recorded clip instead of the unreliable Web Speech engine.
export function getSpeechRecognitionConstructor(): any {
  if (typeof window === 'undefined') return null;
  const native = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
  return mobile || !native ? MicrophoneRecognition : native;
}
