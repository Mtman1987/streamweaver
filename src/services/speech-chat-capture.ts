import { mergeSpeechRecognitionSegments } from './speech-transcript';

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event?: any) => void) | null;
  onend: (() => void) | null;
  stop(): void;
  abort(): void;
};

// A recognition result is a snapshot, not a message to publish. Some engines
// revise that snapshot word by word even when interimResults is disabled.
export function captureSpeechChat(recognition: Recognition, callbacks: {
  preview(text: string): void;
  complete(text: string): void;
  error(): void;
}) {
  let finalTranscript = '';
  let latestTranscript = '';
  let ended = false;
  let stopping = false;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.onresult = (event) => {
    if (ended) return;
    const latestSegments: string[] = [];
    const finalSegments: string[] = [];
    for (let i = 0; i < (event.results?.length || 0); i++) {
      const segment = String(event.results[i]?.[0]?.transcript || '').trim();
      if (!segment) continue;
      latestSegments.push(segment);
      if (event.results[i]?.isFinal) finalSegments.push(segment);
    }
    latestTranscript = mergeSpeechRecognitionSegments(latestSegments);
    const nextFinal = mergeSpeechRecognitionSegments(finalSegments);
    if (nextFinal) finalTranscript = nextFinal;
    callbacks.preview(finalTranscript || latestTranscript);
  };
  recognition.onerror = () => {
    if (ended) return;
    const captured = finalTranscript || latestTranscript;
    ended = true;
    if (captured) callbacks.complete(captured);
    else callbacks.error();
  };
  recognition.onend = () => {
    if (ended) return;
    ended = true;
    callbacks.complete(finalTranscript || latestTranscript);
  };
  return {
    stop() {
      if (ended || stopping) return;
      stopping = true;
      recognition.stop();
    },
    cancel() {
      if (ended) return;
      ended = true;
      recognition.abort();
    },
  };
}
