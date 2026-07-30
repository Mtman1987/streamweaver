import Link from "next/link";
import { ExternalLink, MessageSquareText } from "lucide-react";

export default function MessagingPage() {
  return (
    <section className="flex min-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60 shadow-2xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold"><MessageSquareText className="h-5 w-5" /> Commlink Messaging</h1>
          <p className="text-xs text-muted-foreground">The canonical SPMT workspace for stream chat, Discord, events, voice, and media.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link className="rounded-lg border border-white/10 px-3 py-2 hover:bg-white/10" href="/native-chat">StreamWeaver native tools</Link>
          <a className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/10" href="https://spmt.live/?view=commlink" target="_blank" rel="noopener noreferrer">
            Open full workspace <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>
      <iframe
        className="min-h-0 flex-1 border-0"
        src="https://spmt.live/commlink/?embedded=1"
        title="SPMT Commlink messaging workspace"
        allow="microphone; autoplay; clipboard-write"
      />
    </section>
  );
}
