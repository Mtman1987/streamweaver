export interface BrowserSpeechOptions {
  continuous?: boolean;
  interimResults?: boolean;
  language?: string;
  silenceTimeoutMs?: number;
}

export interface SpeechResult {
  transcription: string;
  confidence: number;
  isFinal: boolean;
}

class BrowserSpeechRecognition {
  private recognition: any = null;
  private isRecognizing: boolean = false;
  private initialized: boolean = false;
  private stopRequested: boolean = false;

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
      }
    }
  }

  isAvailable(): boolean {
    this.ensureInitialized();
    return this.recognition !== null;
  }

  stop(): void {
    this.stopRequested = true;
    if (this.recognition && this.isRecognizing) {
      this.recognition.stop();
    }
  }

  async startRecognition(options: BrowserSpeechOptions = {}): Promise<SpeechResult[]> {
    this.ensureInitialized();

    if (!this.recognition) {
      throw new Error('Speech recognition not supported in this browser');
    }

    if (this.isRecognizing) {
      throw new Error('Speech recognition already in progress');
    }

    this.stopRequested = false;
    const silenceTimeout = options.silenceTimeoutMs ?? 5000;

    return new Promise((resolve, reject) => {
      const results: SpeechResult[] = [];
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;

      const resetSilenceTimer = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (this.isRecognizing) {
            this.recognition.stop();
          }
        }, silenceTimeout);
      };

      // Use continuous mode so it doesn't auto-stop on short pauses
      this.recognition.continuous = true;
      this.recognition.interimResults = options.interimResults ?? true;
      this.recognition.lang = options.language ?? 'en-US';

      this.recognition.onstart = () => {
        this.isRecognizing = true;
        resetSilenceTimer();
      };

      this.recognition.onresult = (event: any) => {
        resetSilenceTimer();
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          results[i] = {
            transcription: result[0].transcript,
            confidence: result[0].confidence,
            isFinal: result.isFinal,
          };
        }
      };

      this.recognition.onerror = (event: any) => {
        if (silenceTimer) clearTimeout(silenceTimer);
        this.isRecognizing = false;
        if (event.error === 'network' || event.error === 'aborted') {
          resolve(results.length > 0 ? results : []);
          return;
        }
        if (event.error === 'no-speech') {
          reject(new Error('No speech detected'));
          return;
        }
        reject(new Error(`Speech recognition error: ${event.error}`));
      };

      this.recognition.onend = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        this.isRecognizing = false;
        resolve(results);
      };

      try {
        this.recognition.start();
      } catch (error) {
        reject(error);
      }
    });
  }
}

export const browserSpeechRecognition = new BrowserSpeechRecognition();
