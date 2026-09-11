import { mergeSpeechRecognitionSegments } from './speech-transcript';

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: (() => void) | null;
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
  let transcript = '';
  let ended = false;
  let stopping = false;
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  recognition.onresult = (event) => {
    if (ended) return;
    const finalSegments: string[] = [];
    for (let i = 0; i < (event.results?.length || 0); i++) {
      if (event.results[i]?.isFinal) finalSegments.push(event.results[i][0]?.transcript || '');
    }
    transcript = mergeSpeechRecognitionSegments(finalSegments);
    callbacks.preview(transcript);
  };
  recognition.onerror = () => {
    if (ended) return;
    ended = true;
    callbacks.error();
  };
  recognition.onend = () => {
    if (ended) return;
    ended = true;
    callbacks.complete(transcript);
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
