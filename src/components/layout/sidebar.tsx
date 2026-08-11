"use client";

import type { ElementType } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  Bot,
  Coins,
  FileText,
  Gift,
  LayoutDashboard,
  Link2,
  MessageSquareText,
  Mic,
  Rocket,
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
  SidebarRail,
} from "@/components/ui/sidebar";
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
      { href: "/private-chat", icon: MessageSquareText, label: "Private Chat" },
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
    <Sidebar collapsible="icon" className="border-r-0 bg-transparent" data-workspace-sidebar>
      <SidebarHeader className="gap-4 border-b border-sidebar-border/40 bg-[linear-gradient(180deg,rgba(10,14,28,0.94),rgba(10,14,28,0.72))] px-4 py-4 backdrop-blur-xl group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:py-2">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 shadow-[0_18px_40px_rgba(3,8,24,0.22)] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:shadow-none">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8">
            <Image src="/app-icon.png" alt="StreamWeaver" fill className="object-cover" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="text-sm font-semibold tracking-tight">StreamWeaver</div>
            <div className="text-xs text-sidebar-foreground/65">Flow-based stream control</div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="bg-[linear-gradient(180deg,rgba(8,11,24,0.84),rgba(8,11,24,0.66))] px-3 py-3 backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden group-data-[collapsible=icon]:px-1">
        {workspaceGroups.map((group) => (
          <SidebarGroup key={group.label} className="py-2 group-data-[collapsible=icon]:px-0">
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

      <SidebarFooter className="border-t border-sidebar-border/40 bg-[linear-gradient(180deg,rgba(8,11,24,0.74),rgba(8,11,24,0.94))] px-3 pb-20 pt-3 backdrop-blur-xl group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:pt-2">
        <UserNav userProfile={userProfile} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
