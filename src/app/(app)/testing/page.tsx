"use client";

import { useState } from "react";

type TestId = "tts" | "voice" | "ai" | "picture" | "free-models";
type TestOutput = { id: TestId; title: string; startedAt: string; finishedAt: string; summary: string; payload: any };

const tests: { id: TestId; title: string; description: string; button: string }[] = [
  { id: "tts", title: "TTS chain", description: "Calls StreamWeaver's actual TTS service and checks that it returns playable audio.", button: "Test TTS chain" },
  { id: "voice", title: "Voice response chain", description: "Checks configured AI-text and speech providers separately, then reports which combined voice-response pairs can work.", button: "Test voice chain" },
  { id: "ai", title: "AI text chain candidates", description: "Checks the configured free Gemini candidates and OpenRouter free router with short prompts.", button: "Test AI chain" },
  { id: "picture", title: "Picture generation chain", description: "Requests one small public test image through the configured image-generation path and checks for a returned image.", button: "Test picture chain" },
  { id: "free-models", title: "Free model candidates", description: "Runs the focused free-model diagnostic independently of the broader provider sweep.", button: "Test free models" },
];

function collectImageUrls(value: any, found: string[] = [], depth = 0): string[] {
  if (depth > 5 || value == null) return found;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(value)) found.push(value);
    return found;
  }
  if (Array.isArray(value)) value.forEach(item => collectImageUrls(item, found, depth + 1));
  else if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (/^(image|images|imageUrl|imageUrls|imageResourceUrl|imageResourceUrls|url)$/i.test(key)) collectImageUrls(item, found, depth + 1);
    }
  }
  return [...new Set(found)];
}

export default function TestingPage() {
  const [running, setRunning] = useState<TestId | "all" | null>(null);
  const [outputs, setOutputs] = useState<Partial<Record<TestId, TestOutput>>>({});
  const [errors, setErrors] = useState<Partial<Record<TestId, string>>>({});

  async function runOne(id: TestId): Promise<void> {
    const startedAt = new Date().toISOString();
    let url = "";
    let init: RequestInit = { method: "POST" };
    if (id === "tts") {
      url = "/api/tts";
      init = { ...init, headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "StreamWeaver text to speech chain test. If you can hear this, speech generation returned audio." }) };
    } else if (id === "voice") {
      url = "/api/testing/provider-sweep";
    } else if (id === "ai" || id === "free-models") {
      url = "/api/testing/free-model-candidates";
    } else {
      url = "/api/ai/image";
      init = { ...init, headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "A simple cheerful blue mountain under a clear sky, clean illustration, no text, diagnostic test image.", numImages: 1, scope: "public" }) };
    }
    try {
      const response = await fetch(url, init);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || payload?.message || ("Request failed with HTTP " + response.status));
      let summary = "Request completed.";
      if (id === "tts") {
        const audio = payload?.audioDataUri || payload?.data?.audioDataUri;
        if (typeof audio !== "string" || !audio.startsWith("data:audio/")) {
          if (payload?.available === false || payload?.data?.available === false) throw new Error(payload?.reason || payload?.data?.reason || "TTS service responded, but no audio was available.");
          throw new Error("TTS endpoint returned no recognizable audio data. See response details.");
        }
        summary = "PASS — audio generated (" + Math.round(audio.length * 0.75 / 1024) + " KB encoded estimate).";
        payload.audioDataUri = audio;
      } else if (id === "picture") {
        const images = collectImageUrls(payload);
        const hasImage = images.length > 0 || JSON.stringify(payload).includes("data:image/");
        if (!hasImage) throw new Error("The image request completed without a recognizable image URL. Check the response details.");
        summary = "PASS — image output detected.";
        payload.__testImageUrls = images;
      } else {
        const results = Array.isArray(payload?.results) ? payload.results : [];
        const passes = results.filter((item: any) => String(item.status).startsWith("PASS")).length;
        summary = passes + " of " + results.length + " reported checks passed.";
        if (!results.length) summary = "Request completed; see response details.";
      }
      setOutputs(prev => ({ ...prev, [id]: { id, title: tests.find(t => t.id === id)?.title || id, startedAt, finishedAt: new Date().toISOString(), summary, payload } }));
      setErrors(prev => ({ ...prev, [id]: "" }));
    } catch (error) {
      setErrors(prev => ({ ...prev, [id]: error instanceof Error ? error.message : "Test failed." }));
    }
  }

  async function run(id: TestId | "all") {
    if (running) return;
    setRunning(id);
    if (id === "all") {
      for (const test of tests) await runOne(test.id);
    } else {
      await runOne(id);
    }
    setRunning(null);
  }

  async function copyOutput(id: TestId) {
    const output = outputs[id];
    if (!output) return;
    await navigator.clipboard.writeText(JSON.stringify({ title: output.title, startedAt: output.startedAt, finishedAt: output.finishedAt, summary: output.summary, payload: { ...output.payload, audioDataUri: output.payload?.audioDataUri ? "[audio omitted]" : undefined } }, null, 2));
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Diagnostics</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Provider & Chain Tests</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Run each check when something breaks. Results show provider responses and errors without exposing secret values. Provider sweeps and free-model tests make real API requests; the picture test generates one public diagnostic image.</p>
        <button type="button" onClick={() => run("all")} disabled={running !== null} className="mt-4 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">{running === "all" ? "Running all tests…" : "Run all tests"}</button>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        {tests.map(test => {
          const output = outputs[test.id];
          const error = errors[test.id];
          const isRunning = running === test.id || running === "all";
          const images: string[] = output?.payload?.__testImageUrls || [];
          const audio = output?.payload?.audioDataUri || output?.payload?.data?.audioDataUri;
          return (
            <article key={test.id} className="min-w-0 rounded-xl border p-5">
              <h2 className="text-lg font-semibold">{test.title}</h2>
              <p className="mt-2 min-h-12 text-sm text-muted-foreground">{test.description}</p>
              <button type="button" onClick={() => run(test.id)} disabled={running !== null} className="mt-4 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60">{isRunning ? "Testing…" : test.button}</button>
              {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
              {output ? (
                <div className="mt-4 space-y-3 border-t pt-4">
                  <p className="text-sm font-semibold">{output.summary}</p>
                  <p className="text-xs text-muted-foreground">Finished {new Date(output.finishedAt).toLocaleString()}</p>
                  {typeof audio === "string" && audio.startsWith("data:audio/") ? <audio controls preload="none" src={audio} className="w-full" /> : null}
                  {images.map(src => <img key={src} src={src} alt="Generated diagnostic image" className="max-h-64 w-full rounded-lg object-contain" />)}
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">View test details</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">{JSON.stringify({ ...output.payload, audioDataUri: audio ? "[audio omitted from details]" : undefined }, null, 2)}</pre>
                  </details>
                  <button type="button" onClick={() => copyOutput(test.id)} className="rounded-lg border px-3 py-2 text-xs font-medium">Copy results</button>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
      <p className="text-xs text-muted-foreground">A provider credential sweep is a direct provider diagnostic, not proof that every production fallback transition was triggered. TTS and picture tests exercise StreamWeaver's application endpoints. A missing provider key is reported as not configured by the diagnostic endpoint.</p>
    </main>
  );
}
