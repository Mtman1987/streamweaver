"use client";
import { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import Image from "next/image";

function GlobalActiveUsersHeader() {
  const [activeUsers, setActiveUsers] = useState<any[]>([]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let tenantId: string | null = null;
    import("@/lib/client-tenant").then(mod => {
      tenantId = mod.getClientTenantId();
      const { getBrowserWebSocketUrl } = require("@/lib/ws-config");
      ws = new WebSocket(getBrowserWebSocketUrl(tenantId || undefined));
      ws.onopen = () => {
        fetch("/api/user-profile").then(r => r.json()).then(profile => {
          ws?.send(
            JSON.stringify({
              type: "identify",
              payload: {
                tenantId,
                userProfile: profile.twitch || {},
              },
            })
          );
        });
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "global-active-users-update") {
            setActiveUsers(data.payload.users || []);
          }
        } catch {}
      };
    });
    return () => {
      ws?.close();
    };
  }, []);

  if (!activeUsers.length) return null;
  return (
    <div className="flex items-center gap-1">
      {activeUsers.map((user) => (
        <img
          key={user.tenantId}
          src={user.avatar || "/StreamWeaver.png"}
          alt={user.displayName || user.username}
          title={user.displayName || user.username}
          className="w-8 h-8 rounded-full border border-accent"
        />
      ))}
    </div>
  );
}

export default function Header() {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background/80 backdrop-blur-sm px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-0 mb-4">
      <div className="flex items-center gap-3">
        <div className="md:hidden">
          <SidebarTrigger />
        </div>
        <div className="flex items-center gap-2">
          <Image
            src="/StreamWeaver.png"
            alt="StreamWeaver"
            width={32}
            height={32}
            className="rounded-md"
          />
          <span className="font-bold text-lg hidden sm:inline bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            StreamWeaver
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <GlobalActiveUsersHeader />
      </div>
    </header>
  );
}
