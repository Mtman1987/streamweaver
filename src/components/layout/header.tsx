"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, CheckCircle2, ExternalLink, Flame, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type HeaderMeta = {
  title: string;
  description: string;
  primaryHref?: string;
  primaryLabel?: string;
};

const headerMeta: Record<string, HeaderMeta> = {
  "/dashboard": {
    title: "Dashboard",
    description: "Live status, quick actions, and the latest activity across your workspace.",
    primaryHref: "/commands",
    primaryLabel: "Build commands",
  },
  "/commands": {
    title: "Commands",
    description: "Create and manage triggers for chat, automation, and quick responses.",
    primaryHref: "/actions",
    primaryLabel: "Link actions",
  },
  "/actions": {
    title: "Actions",
    description: "Compose multi-step automations and attach them to triggers.",
    primaryHref: "/active-commands",
    primaryLabel: "Review workflows",
  },
  "/active-commands": {
    title: "Workflows",
    description: "Connect commands or events to action flows, then review and test the complete automation.",
  },
  "/chat": {
    title: "Messaging",
    description: "Read Discord, watch Twitch chat, and send typed or dictated messages.",
    primaryHref: "/commands",
    primaryLabel: "Build commands",
  },
  "/integrations": {
    title: "Integrations",
    description: "Connect Twitch, OBS, Discord, and the rest of your stack.",
    primaryHref: "/overlay-urls",
    primaryLabel: "Open overlays",
  },
  "/overlay-urls": {
    title: "Overlay URLs",
    description: "Copy and manage the browser sources StreamWeaver exposes to your stream.",
  },
  "/community": {
    title: "Community",
    description: "Browse shared automations and import pieces that fit your stream.",
  },
};

function GlobalActivityPulse() {
  return (
    <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
      <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_0_4px_rgba(38,215,215,0.12)]" />
      <span>Runtime online</span>
    </div>
  );
}

export default function Header() {
  const pathname = usePathname();
  const meta = useMemo(() => {
    const exact = headerMeta[pathname];
    if (exact) return exact;

    if (pathname.startsWith("/commands")) {
      return headerMeta["/commands"];
    }
    if (pathname.startsWith("/actions")) {
      return headerMeta["/actions"];
    }
    if (pathname.startsWith("/active-commands")) {
      return headerMeta["/active-commands"];
    }
    if (pathname.startsWith("/chat")) {
      return headerMeta["/chat"];
    }
    if (pathname.startsWith("/integrations")) {
      return headerMeta["/integrations"];
    }
    if (pathname.startsWith("/overlay-urls")) {
      return headerMeta["/overlay-urls"];
    }
    if (pathname.startsWith("/community")) {
      return headerMeta["/community"];
    }
    return {
      title: "StreamWeaver",
      description: "A workspace for commands, actions, overlays, and live bot control.",
      primaryHref: "/dashboard",
      primaryLabel: "Open dashboard",
    };
  }, [pathname]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [healthLabel, setHealthLabel] = useState("Checking");

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const response = await fetch("/api/__health", { cache: "no-store" });
        if (!active) return;
        setHealthLabel(response.ok ? "Healthy" : "Degraded");
      } catch {
        if (active) setHealthLabel("Offline");
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [pathname]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetch("/api/__health", { cache: "no-store" });
      window.location.reload();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl sm:px-6">
      <div className="flex items-center gap-3">
        <div className="md:hidden">
          <SidebarTrigger />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="relative h-10 w-10 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
            <Image src="/StreamWeaver.png" alt="StreamWeaver" fill className="object-cover" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-accent/40 bg-accent/10 text-accent">
                {healthLabel}
              </Badge>
              <Badge variant="outline" className="hidden border-border/80 bg-card/70 text-muted-foreground md:inline-flex">
                <Bot className="mr-1 h-3.5 w-3.5 text-accent" />
                AI ready
              </Badge>
              <div className="hidden md:block">
                <GlobalActivityPulse />
              </div>
              <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{meta.title}</h1>
            </div>
            <p className="mt-0.5 max-w-2xl truncate text-sm text-muted-foreground">{meta.description}</p>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
            Refresh
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href="/dashboard#setup">
              <CheckCircle2 className="h-4 w-4" />
              Review setup
            </Link>
          </Button>
          {meta.primaryHref ? (
            <Button asChild size="sm" className="gap-2">
              <Link href={meta.primaryHref}>
                {meta.primaryLabel}
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 md:hidden">
        <GlobalActivityPulse />
        <Badge variant="outline" className="border-border/80 bg-card/70 text-muted-foreground">
          <Sparkles className="mr-1 h-3.5 w-3.5 text-accent" />
          AI ready
        </Badge>
        <Badge variant="outline" className="border-border/80 bg-card/70 text-muted-foreground">
          <Flame className="mr-1 h-3.5 w-3.5 text-primary" />
          Live workspace
        </Badge>
      </div>
    </header>
  );
}
