"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Radio, Send, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { getBrowserWebSocketUrl } from "@/lib/ws-config";
import { getClientTenantId } from "@/lib/client-tenant";
import { applySavedSink } from "@/services/audio-sink";

const AUTO_SEND_STORAGE_KEY = "streamweaver.voiceReply.autoSend";

type VoiceReplyRequest = {
  requestId: string;
  tenantId?: string;
  userName: string;
  displayName?: string;
  message: string;
  readbackText: string;
  audioDataUri?: string;
  waitMs: number;
  recordMs: number;
  autoSend: boolean;
  sendAs: "bot" | "broadcaster";
};

type RequestState = VoiceReplyRequest & {
  status: "queued" | "reading" | "waiting" | "recording" | "transcribing" | "ready" | "sent" | "failed";
  transcription?: string;
  error?: string;
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read audio."));
    reader.readAsDataURL(blob);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function playAudioUrl(audioUrl: string): Promise<void> {
  if (!audioUrl) return;
  const audio = new Audio(audioUrl);
  audio.volume = 1;
  try {
    await applySavedSink(audio);
  } catch {}
  await audio.play();
  await new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
  });
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const samples = buffer.getChannelData(0);
  const arrayBuffer = new ArrayBuffer(samples.length * 2 + 44);
  const view = new DataView(arrayBuffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return arrayBuffer;
}

async function playDing(): Promise<void> {
  const OfflineContextCtor = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!OfflineContextCtor) return;
  const sampleRate = 48000;
  const ctx = new OfflineContextCtor(1, sampleRate * 0.35, sampleRate);
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, 0);
  gain.gain.exponentialRampToValueAtTime(0.2, 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, 0.32);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(0);
  oscillator.stop(0.35);
  const rendered = await ctx.startRendering();
  const blob = new Blob([audioBufferToWav(rendered)], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  try {
    await playAudioUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function VoiceReplyPage() {
  const [connected, setConnected] = useState(false);
  const [autoSendDefault, setAutoSendDefault] = useState(true);
  const [current, setCurrent] = useState<RequestState | null>(null);
  const [history, setHistory] = useState<RequestState[]>([]);
  const processingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const updateCurrent = (patch: Partial<RequestState>) => {
    setCurrent((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(AUTO_SEND_STORAGE_KEY);
      if (saved === "true" || saved === "false") {
        setAutoSendDefault(saved === "true");
      }
    } catch {}
  }, []);

  const setAutoSendPreference = (value: boolean) => {
    setAutoSendDefault(value);
    try {
      window.localStorage.setItem(AUTO_SEND_STORAGE_KEY, String(value));
    } catch {}
  };

  const sendToChat = async (text: string, sendAs: "bot" | "broadcaster") => {
    const res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, as: sendAs }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "Failed to send chat message.");
    }
  };

  const recordOnce = async (recordMs: number): Promise<string> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    const chunks: Blob[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.start();
      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, recordMs);
    });
    stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;

    const dataUrl = await blobToDataUrl(new Blob(chunks, { type: "audio/webm" }));
    const base64Audio = dataUrl.split(",")[1] || "";
    if (!base64Audio) throw new Error("No microphone audio was captured.");
    return base64Audio;
  };

  const processRequest = async (request: VoiceReplyRequest) => {
    if (processingRef.current) return;
    processingRef.current = true;
    const next: RequestState = {
      ...request,
      autoSend: request.autoSend && autoSendDefault,
      status: "queued",
    };
    setCurrent(next);

    try {
      updateCurrent({ status: "reading" });
      await playAudioUrl(request.audioDataUri || "");

      updateCurrent({ status: "waiting" });
      await wait(Math.max(0, request.waitMs || 5000));
      await playDing();

      updateCurrent({ status: "recording" });
      const base64Audio = await recordOnce(Math.max(1000, request.recordMs || 10000));

      updateCurrent({ status: "transcribing" });
      const transcribeRes = await fetch("/api/speech/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Audio }),
      });
      const transcribeData = await transcribeRes.json().catch(() => ({}));
      if (!transcribeRes.ok || transcribeData?.error) {
        throw new Error(transcribeData?.error || "Transcription failed.");
      }

      const transcription = String(transcribeData?.data?.transcription || transcribeData?.transcription || "").trim();
      if (!transcription) throw new Error("Transcription was empty.");

      if (request.autoSend && autoSendDefault) {
        await sendToChat(transcription, request.sendAs || "bot");
        const sentState = { ...next, transcription, status: "sent" as const };
        setCurrent(sentState);
        setHistory((prev) => [sentState, ...prev].slice(0, 10));
      } else {
        setCurrent({ ...next, transcription, status: "ready" });
      }
    } catch (error: any) {
      const failed = { ...next, status: "failed" as const, error: error?.message || String(error) };
      setCurrent(failed);
      setHistory((prev) => [failed, ...prev].slice(0, 10));
    } finally {
      processingRef.current = false;
    }
  };

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(getBrowserWebSocketUrl(getClientTenantId() || undefined));
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        reconnect = setTimeout(connect, 2000);
      };
      socket.onerror = () => setConnected(false);
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.type === "voice-reply-request" && data.payload?.requestId) {
            void processRequest(data.payload as VoiceReplyRequest);
          }
        } catch {}
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendDefault]);

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const manualSend = async () => {
    if (!current?.transcription) return;
    await sendToChat(current.transcription, current.sendAs || "bot");
    const sent = { ...current, status: "sent" as const };
    setCurrent(sent);
    setHistory((prev) => [sent, ...prev].slice(0, 10));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Voice Reply</h1>
          <p className="text-sm text-muted-foreground">Use only for workflows that contain a Voice Reply Prompt step.</p>
        </div>
        <Badge variant={connected ? "default" : "secondary"}>{connected ? "Connected" : "Disconnected"}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5" />
            Workflow voice capture
          </CardTitle>
          <CardDescription>
            When a workflow asks for a spoken reply, this page plays the private readback TTS, records your microphone, transcribes it, then sends or waits for approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 rounded-md border bg-muted/25 p-3 text-sm md:grid-cols-3">
            <div>
              <div className="font-medium">1. Trigger</div>
              <div className="mt-1 text-xs text-muted-foreground">A workflow reaches a Voice Reply Prompt step.</div>
            </div>
            <div>
              <div className="font-medium">2. Capture</div>
              <div className="mt-1 text-xs text-muted-foreground">TTS plays privately, then the mic records your response.</div>
            </div>
            <div>
              <div className="font-medium">3. Send</div>
              <div className="mt-1 text-xs text-muted-foreground">The transcription sends automatically or waits here.</div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <div className="text-sm font-medium">Automatic Send</div>
              <div className="text-xs text-muted-foreground">Saved in this browser. When off, transcribed replies wait here for approval.</div>
            </div>
            <Switch checked={autoSendDefault} onCheckedChange={setAutoSendPreference} />
          </div>

          {current ? (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{current.displayName || current.userName}</div>
                  <div className="text-xs text-muted-foreground truncate">{current.message}</div>
                </div>
                <Badge variant={current.status === "failed" ? "destructive" : "outline"}>{current.status}</Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {current.status === "reading" ? <Volume2 className="h-4 w-4" /> : null}
                {current.status === "recording" ? <Mic className="h-4 w-4" /> : null}
                <span>{current.readbackText}</span>
              </div>
              {current.status === "recording" ? (
                <Button variant="secondary" onClick={stopRecording}>
                  <Square className="mr-2 h-4 w-4" />
                  Stop Recording
                </Button>
              ) : null}
              {current.transcription != null ? (
                <div className="space-y-2">
                  <Textarea value={current.transcription} onChange={(e) => updateCurrent({ transcription: e.target.value })} rows={3} />
                  {current.status === "ready" ? (
                    <Button onClick={manualSend}>
                      <Send className="mr-2 h-4 w-4" />
                      Send Reply
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {current.error ? <div className="text-sm text-destructive">{current.error}</div> : null}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No voice reply request is active. If this never changes, the selected workflow probably does not contain a Voice Reply Prompt step.
            </div>
          )}
        </CardContent>
      </Card>

      {history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent Replies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.map((item) => (
              <div key={item.requestId} className="rounded-md border px-3 py-2 text-sm">
                <div className="font-medium">{item.displayName || item.userName}</div>
                <div className="text-muted-foreground">{item.transcription || item.error}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
