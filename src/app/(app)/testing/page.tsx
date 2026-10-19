"use client";

import { useState } from "react";

type TestId = "tts" | "voice" | "ai" | "picture";
type TestOutput = { id: TestId; title: string; startedAt: string; finishedAt: string; summary: string; payload: any };

const tests: { id: TestId; title: string; description: string; button: string }[] = [
  { id: "tts", title: "TTS chain", description: "Calls StreamWeaver's real speech endpoint and returns playable audio for listening.", button: "Test TTS chain" },
  { id: "voice", title: "Full voice response chain", description: "Runs the actual free AI response chain, sends its answer through the actual TTS endpoint, and verifies both outputs.", button: "Test voice chain" },
  { id: "ai", title: "Free AI model chain", description: "Tests the currently configured free AI providers with tiny prompts, current model IDs, correct API formats, bounded timeouts, and model fallbacks.", button: "Test AI chain" },
  { id: "picture", title: "Picture generation chain", description: "Generates one public diagnostic image through StreamWeaver's image endpoint and checks for usable image output.", button: "Test picture chain" },
];

function collectImageUrls(value: any, found: string[] = [], depth = 0): string[] {
  if (depth > 7 || value == null) return found;
  if (typeof value === "string") {
    if (
      (/^https?:\/\//i.test(value) && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(value)) ||
      /^\/api\/ai\/image\/file\//i.test(value) ||
      /^data:image\//i.test(value)
    ) found.push(value);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectImageUrls(item, found, depth + 1));
  } else if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (/^(image|images|imageUrl|imageUrls|imageResourceUrl|imageResourceUrls|persistedImageUrl|persistedImageUrls|url)$/i.test(key)) {
        collectImageUrls(item, found, depth + 1);
      } else if (item && typeof item === "object") {
        collectImageUrls(item, found, depth + 1);
      }
    }
  }
  return [...new Set(found)];
}

function withoutLargeMedia(value: any, depth = 0): any {
  if (depth > 8 || value == null) return value;
  if (typeof value === "string") {
    return value.startsWith("data:audio/") || value.startsWith("data:image/")
      ? "[encoded media omitted from copied details]"
      : value;
  }
  if (Array.isArray(value)) return value.map(item => withoutLargeMedia(item, depth + 1));
  if (typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /^(audioDataUri|audioContent|base64Audio|imageDataUri)$/i.test(key)
      ? "[media omitted]"
      : withoutLargeMedia(item, depth + 1),
  ]));
}

export default function TestingPage() {
  const [running, setRunning] = useState<TestId | "all" | null>(null);
  const [outputs, setOutputs] = useState<Partial<Record<TestId, TestOutput>>>({});
  const [errors, setErrors] = useState<Partial<Record<TestId, string>>>({});

  async function requestJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || payload?.error || payload?.message;
      throw new Error((typeof message === "string" && message) || ("Request failed with HTTP " + response.status));
    }
    return payload;
  }

  async function runOne(id: TestId): Promise<void> {
    const startedAt = new Date().toISOString();
    setErrors(prev => ({ ...prev, [id]: "" }));
    try {
      let summary = "Request completed.";
      let payload: any;

      if (id === "tts") {
        payload = await requestJson("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "StreamWeaver text to speech chain test. If you can hear this, speech generation returned audio." }),
        }, 40_000);
        const audio = payload?.audioDataUri || payload?.data?.audioDataUri;
        if (typeof audio !== "string" || !audio.startsWith("data:audio/")) {
          if (payload?.available === false || payload?.data?.available === false) {
            throw new Error(payload?.reason || payload?.data?.reason || "TTS endpoint responded, but free speech was unavailable.");
          }
          throw new Error("TTS endpoint returned no recognizable audio data. Expand test details to inspect the response.");
        }
        payload.audioDataUri = audio;
        summary = "PASS — StreamWeaver returned playable audio (" + Math.round(audio.length * 0.75 / 1024) + " KB encoded estimate).";
      } else if (id === "voice") {
        const aiResponse = await requestJson("/api/ai/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "Reply with one short sentence: StreamWeaver voice response test passed." }),
        }, 40_000);
        const generatedText = aiResponse?.text || aiResponse?.data?.text;
        if (typeof generatedText !== "string" || !generatedText.trim()) {
          throw new Error("The AI endpoint returned no usable text. Check the provider chain test for provider-specific results.");
        }
        const speechResponse = await requestJson("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: generatedText.slice(0, 2000) }),
        }, 40_000);
        const audio = speechResponse?.audioDataUri || speechResponse?.data?.audioDataUri;
        if (typeof audio !== "string" || !audio.startsWith("data:audio/")) {
          throw new Error(speechResponse?.reason || speechResponse?.data?.reason || "AI returned text, but TTS did not return playable audio.");
        }
        payload = {
          ai: withoutLargeMedia(aiResponse),
          generatedText,
          speech: withoutLargeMedia(speechResponse),
          audioDataUri: audio,
        };
        summary = "PASS — free AI generated text and TTS returned playable audio.";
      } else if (id === "ai") {
        payload = await requestJson("/api/testing/free-model-candidates", { method: "POST" }, 50_000);
        const results = Array.isArray(payload?.results) ? payload.results : [];
        const passes = results.filter((item: any) => String(item.status).startsWith("PASS")).length;
        const attempts = results.filter((item: any) => !String(item.status).startsWith("SKIPPED")).length;
        summary = passes + " passing candidate(s) out of " + attempts + " attempted check(s).";
        if (!results.length) summary = "Endpoint responded, but no provider results were returned.";
      } else {
        payload = await requestJson("/api/ai/image", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: "A simple cheerful blue mountain under a clear sky, clean illustration, no text, diagnostic test image.",
            numImages: 1,
            scope: "public",
          }),
        }, 90_000);
        const images = collectImageUrls(payload);
        if (!images.length) {
          throw new Error("The image endpoint completed without a recognizable image URL. Expand test details to inspect the response.");
        }
        payload.__testImageUrls = images;
        summary = "PASS — " + images.length + " usable image output(s) detected.";
      }

      setOutputs(prev => ({
        ...prev,
        [id]: {
          id,
          title: tests.find(t => t.id === id)?.title || id,
          startedAt,
          finishedAt: new Date().toISOString(),
          summary,
          payload,
        },
      }));
    } catch (error) {
      setErrors(prev => ({ ...prev, [id]: error instanceof Error ? error.message : "Test failed." }));
    }
  }

  async function run(id: TestId | "all") {
    if (running) return;
    setRunning(id);
    try {
      if (id === "all") {
        for (const test of tests) await runOne(test.id);
      } else {
        await runOne(id);
      }
    } finally {
      setRunning(null);
    }
  }

  async function copyOutput(id: TestId) {
    const output = outputs[id];
    if (!output) return;
    await navigator.clipboard.writeText(JSON.stringify({
      title: output.title,
      startedAt: output.startedAt,
      finishedAt: output.finishedAt,
      summary: output.summary,
      payload: withoutLargeMedia(output.payload),
    }, null, 2));
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Diagnostics</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Provider & Chain Tests</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Run a test individually or use Run all tests. Real endpoints are exercised where possible; model probes use small prompts and bounded per-request timeouts. Paid providers are not called by the free-model candidate sweep.
        </p>
        <button type="button" onClick={() => run("all")} disabled={running !== null} className="mt-4 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">
          {running === "all" ? "Running all tests…" : "Run all tests"}
        </button>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        {tests.map(test => {
          const output = outputs[test.id];
          const error = errors[test.id];
          const isRunning = running === test.id || running === "all";
          const images: string[] = output?.payload?.__testImageUrls || [];
          const audio = output?.payload?.audioDataUri || output?.payload?.data?.audioDataUri;
          const displayPayload = withoutLargeMedia(output?.payload);
          return (
            <article key={test.id} className="min-w-0 rounded-xl border p-5">
              <h2 className="text-lg font-semibold">{test.title}</h2>
              <p className="mt-2 min-h-12 text-sm text-muted-foreground">{test.description}</p>
              <button type="button" onClick={() => run(test.id)} disabled={running !== null} className="mt-4 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60">
                {isRunning ? "Testing…" : test.button}
              </button>
              {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
              {output ? (
                <div className="mt-4 space-y-3 border-t pt-4">
                  <p className="text-sm font-semibold">{output.summary}</p>
                  {id === "ai" && Array.isArray(output.payload?.results) ? (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted">
                          <tr>
                            <th className="p-2">Provider</th>
                            <th className="p-2">Model</th>
                            <th className="p-2">Result</th>
                            <th className="p-2">HTTP</th>
                            <th className="p-2">Time</th>
                            <th className="p-2">Output</th>
                          </tr>
                        </thead>
                        <tbody>
                          {output.payload.results.map((item: any, index: number) => (
                            <tr key={String(item.provider) + "-" + String(item.model) + "-" + index} className="border-t align-top">
                              <td className="p-2">{item.provider || "—"}</td>
                              <td className="p-2 font-mono">{item.model || "—"}</td>
                              <td className="p-2 font-semibold">{item.status || "UNKNOWN"}</td>
                              <td className="p-2">{item.httpStatus ?? "—"}</td>
                              <td className="p-2">{Number.isFinite(Number(item.ms)) ? Number(item.ms) + " ms" : "—"}</td>
                              <td className="p-2">{item.outputTextLength ?? "—"} chars</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <p className="text-xs text-muted-foreground">Finished {new Date(output.finishedAt).toLocaleString()}</p>
                  {typeof audio === "string" && audio.startsWith("data:audio/") ? <audio controls preload="none" src={audio} className="w-full" /> : null}
                  {images.map(src => <img key={src} src={src} alt="Generated diagnostic image" className="max-h-64 w-full rounded-lg object-contain" />)}
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">View test details</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">{JSON.stringify(displayPayload, null, 2)}</pre>
                  </details>
                  <button type="button" onClick={() => copyOutput(test.id)} className="rounded-lg border px-3 py-2 text-xs font-medium">Copy results</button>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
      <p className="text-xs text-muted-foreground">
        Model candidate results are direct text-provider probes. The voice test validates the real AI-to-TTS path. A successful test is point-in-time evidence, not a guarantee that a provider will remain available later.
      </p>
    </main>
  );
}
