"use client";

import type { ElementType } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Coins,
  FileText,
  Gift,
  LayoutDashboard,
  Link2,
  MessageSquareText,
  Mic,
  Rocket,
  Settings,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { UserNav } from "@/components/layout/user-nav";
import type { UserProfile } from "./app-shell";

let useLogPanel = () => ({ visible: false, setVisible: (_v: boolean) => {} });
try {
  const mod = require("@/components/logs/log-panel-context");
  if (mod?.useLogPanel) useLogPanel = mod.useLogPanel;
} catch {}

const workspaceGroups = [
  {
    label: "Start Here",
    items: [
      { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { href: "/dashboard#setup", icon: CheckCircle2, label: "Setup Status" },
      { href: "/integrations", icon: Link2, label: "Connections" },
      { href: "/community", icon: Users, label: "Feature Library" },
    ],
  },
  {
    label: "Build Flows",
    items: [
      { href: "/commands", icon: MessageSquareText, label: "Chat Commands" },
      { href: "/actions", icon: Zap, label: "Action Steps" },
      { href: "/active-commands", icon: Rocket, label: "Live Flows" },
      { href: "/voice-reply", icon: Mic, label: "Voice Reply" },
      { href: "/bot-functions", icon: Bot, label: "Bot Functions" },
    ],
  },
  {
    label: "Go Live",
    items: [
      { href: "/chat", icon: MessageSquareText, label: "Messaging" },
      { href: "/overlay-urls", icon: Sparkles, label: "Overlay URLs" },
      { action: "logs", icon: FileText, label: "Logs" },
    ],
  },
  {
    label: "Data + Rewards",
    items: [
      { href: "/currency", icon: Coins, label: "Currency" },
      { href: "/redeems", icon: Gift, label: "Redeems" },
      { href: "/debug/data-files", icon: FileText, label: "Live Files" },
    ],
  },
];

interface AppSidebarProps {
  userProfile: UserProfile;
}

function NavButton({
  href,
  icon: Icon,
  label,
  active,
  onClick,
}: {
  href?: string;
  icon: ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const shared = (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
      {active ? <ArrowRight className="ml-auto h-3.5 w-3.5 text-accent" /> : null}
    </>
  );

  if (href) {
    return (
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link href={href}>{shared}</Link>
      </SidebarMenuButton>
    );
  }

  return (
    <SidebarMenuButton onClick={onClick} tooltip={label}>
      {shared}
    </SidebarMenuButton>
  );
}

export default function AppSidebar({ userProfile }: AppSidebarProps) {
  const pathname = usePathname();
  const { setVisible } = useLogPanel();

  return (
    <Sidebar className="border-r border-sidebar-border/80 bg-sidebar">
      <SidebarHeader className="gap-4 border-b border-sidebar-border/60 px-4 py-4">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-2xl border border-sidebar-border/60 bg-sidebar-accent/50 px-3 py-2">
          <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar">
            <Image src="/StreamWeaver.png" alt="StreamWeaver" fill className="object-cover" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">StreamWeaver</div>
            <div className="text-xs text-sidebar-foreground/65">Flow-based stream control</div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 py-3">
        {workspaceGroups.map((group) => (
          <SidebarGroup key={group.label} className="py-2">
            <SidebarGroupLabel className="px-2 text-[11px] uppercase tracking-[0.24em] text-sidebar-foreground/45">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <NavButton
                      href={item.href}
                      icon={item.icon}
                      label={item.label}
                      active={item.href ? !item.href.includes("#") && pathname.startsWith(item.href) : false}
                      onClick={item.action === "logs" ? () => setVisible(true) : undefined}
                    />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/60 px-4 py-4">
        <div className="rounded-2xl border border-sidebar-border/60 bg-sidebar-accent/45 p-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs uppercase tracking-[0.22em] text-sidebar-foreground/45">Account</div>
              <div className="truncate text-sm font-medium">
                {(userProfile?.twitch?.name || userProfile?.discord?.name || "Signed in")}
              </div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Settings className="h-4 w-4" />
            </div>
          </div>
          <Separator className="my-3 bg-sidebar-border/80" />
          <div className="flex items-center justify-between gap-2 text-xs text-sidebar-foreground/65">
            <span>Need a setup check?</span>
            <Link href="/dashboard#setup" className="font-medium text-sidebar-foreground hover:text-accent">
              Review setup
            </Link>
          </div>
        </div>
        <div className="mt-3">
          <UserNav userProfile={userProfile} />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
