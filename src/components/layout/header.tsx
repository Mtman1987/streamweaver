"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";

type HeaderMeta = {
  title: string;
  description: string;
};

const headerMeta: Record<string, HeaderMeta> = {
  "/dashboard": {
    title: "Dashboard",
    description: "Live status and activity across your workspace.",
  },
  "/commands": {
    title: "Commands",
    description: "Create and manage chat and automation triggers.",
  },
  "/actions": {
    title: "Actions",
    description: "Compose reusable automation steps.",
  },
  "/active-commands": {
    title: "Workflows",
    description: "Review and test active automation flows.",
  },
  "/chat": {
    title: "Messaging",
    description: "Twitch, Discord, and dictated messages.",
  },
  "/integrations": {
    title: "Integrations",
    description: "Twitch, OBS, Discord, and connected services.",
  },
  "/overlay-urls": {
    title: "Overlay URLs",
    description: "Browser sources exposed to your stream.",
  },
  "/community": {
    title: "Community",
    description: "Shared automations and feature library.",
  },
};

export default function Header() {
  const pathname = usePathname();
  const meta = useMemo(() => {
    const exact = headerMeta[pathname];
    if (exact) return exact;
    if (pathname.startsWith("/commands")) return headerMeta["/commands"];
    if (pathname.startsWith("/actions")) return headerMeta["/actions"];
    if (pathname.startsWith("/active-commands")) return headerMeta["/active-commands"];
    if (pathname.startsWith("/chat")) return headerMeta["/chat"];
    if (pathname.startsWith("/integrations")) return headerMeta["/integrations"];
    if (pathname.startsWith("/overlay-urls")) return headerMeta["/overlay-urls"];
    if (pathname.startsWith("/community")) return headerMeta["/community"];
    return {
      title: "StreamWeaver",
      description: "Commands, actions, overlays, and live bot control.",
    };
  }, [pathname]);

  const [healthLabel, setHealthLabel] = useState("Checking");

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (active) setHealthLabel(response.ok ? "Healthy" : "Degraded");
      } catch {
        if (active) setHealthLabel("Offline");
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [pathname]);

  return (
    <header className="app-surface sticky top-0 z-20 border-b border-white/10 bg-background/70 px-3 backdrop-blur-xl sm:px-5 lg:px-6" data-workspace-topbar>
      <div className="flex h-14 items-center gap-3">
        <SidebarTrigger aria-label="Collapse or expand StreamWeaver navigation" title="Collapse or expand navigation" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{meta.title}</h1>
            <span
              className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-card/45 px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex"
              title="StreamWeaver runtime health"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {healthLabel}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">{meta.description}</p>
        </div>
      </div>
    </header>
  );
}
