"use client";

import * as React from "react";

type FeaturedPayload = {
  event: null | {
    eventId: string;
    platform: string;
    sourceName?: string;
    channelName?: string;
    sender: { displayName: string; avatarUrl?: string };
    text: string;
    donation?: { display?: string; amount: number; currency: string };
    membership?: { tier?: string };
  };
  presentation: {
    style: "glass" | "solid" | "minimal";
    durationSeconds: number;
  };
};

export default function SharedChatFeaturedOverlay() {
  const [tenant, setTenant] = React.useState("");
  const [payload, setPayload] = React.useState<FeaturedPayload | null>(null);

  React.useEffect(() => {
    setTenant(new URLSearchParams(window.location.search).get("tenant") || "");
  }, []);

  React.useEffect(() => {
    if (!tenant) return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/shared-chat/featured?tenant=${encodeURIComponent(tenant)}`, { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json();
        if (active) setPayload(next);
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => void load(), 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [tenant]);

  if (!payload?.event) return null;
  const { event, presentation } = payload;
  const appearance = presentation.style === "minimal"
    ? "border-l-4 border-cyan-300 bg-transparent"
    : presentation.style === "solid"
      ? "border border-cyan-300/60 bg-slate-950"
      : "border border-white/20 bg-slate-950/75 backdrop-blur-xl";

  return (
    <main className="flex min-h-screen items-end justify-center bg-transparent p-10 font-sans">
      <style jsx global>{`html, body { background: transparent !important; }`}</style>
      <article key={event.eventId} className={`w-full max-w-3xl rounded-2xl p-5 text-white shadow-2xl ${appearance}`}>
        <div className="flex items-center gap-4">
          {event.sender.avatarUrl && <img src={event.sender.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <strong className="text-lg">{event.sender.displayName}</strong>
              <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 font-bold uppercase text-cyan-200">{event.platform}</span>
              <span className="text-white/60">{event.channelName || event.sourceName || ""}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-2xl font-medium leading-snug">{event.text}</p>
            {(event.donation || event.membership) && (
              <p className="mt-2 font-bold text-amber-300">
                {event.donation?.display || (event.donation ? `${event.donation.amount} ${event.donation.currency}` : "")}
                {event.membership ? ` Member ${event.membership.tier || ""}` : ""}
              </p>
            )}
          </div>
        </div>
      </article>
    </main>
  );
}
