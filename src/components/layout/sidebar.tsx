

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import Image from "next/image"
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from "@/components/ui/sidebar"
import { UserNav } from "@/components/layout/user-nav"
import {
  LayoutDashboard,
  Terminal,
  Zap,
  Link2,
  Settings,
  Bot,
  FileText,
  Rocket,
  Users,
  Mic,
  Coins,
  Gift
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { UserProfile } from "@/app/(app)/layout"

// Safe import — falls back to no-op if log panel context is missing
let useLogPanel = () => ({ visible: false, setVisible: (_v: boolean) => {} });
try {
  const mod = require("@/components/logs/log-panel-context");
  if (mod?.useLogPanel) useLogPanel = mod.useLogPanel;
} catch {}

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard", external: false },
  { href: "/commands", icon: Terminal, label: "Commands", external: false },
  { href: "/active-commands", icon: Rocket, label: "Active Commands", external: false },
  { href: "/actions", icon: Zap, label: "Actions", external: false },
  { href: "/bot-functions", icon: Bot, label: "Bot Functions", external: false },
  { href: "/currency", icon: Coins, label: "Currency", external: false },
  { href: "/redeems", icon: Gift, label: "Redeems", external: false },
  { href: "/community", icon: Users, label: "Community", external: false },
  { href: "/debug/data-files", icon: FileText, label: "Live Files", external: false },
  { href: "/integrations", icon: Link2, label: "Integrations", external: false },
]

interface AppSidebarProps {
  userProfile: UserProfile;
}

export default function AppSidebar({ userProfile }: AppSidebarProps) {
  const pathname = usePathname()
  const { setVisible } = useLogPanel();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image src="/StreamWeaver.png" alt="StreamWeaver" width={24} height={24} className="rounded-sm" />
          <span className="font-bold text-lg group-data-[state=collapsed]:hidden">StreamWeaver</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild={!item.external}
                isActive={pathname.startsWith(item.href)}
                tooltip={item.label}
              >
                {item.external ? (
                  <a href={item.href} target="_blank" rel="noopener noreferrer">
                    <item.icon />
                    <span>{item.label}</span>
                  </a>
                ) : (
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
            {/* Log Panel Toggle Button */}
           <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setVisible(true)}
                tooltip="View Logs"
              >
                <FileText />
                <span>Logs</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith("/settings")}
                tooltip="Settings"
              >
                <Link href="/settings">
                  <Settings />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="group-data-[state=collapsed]:-mt-8 group-data-[state=collapsed]:opacity-0 duration-200 transition-[margin,opacity] ease-linear">
            <UserNav userProfile={userProfile} />
          </div>
      </SidebarFooter>
    </Sidebar>
  )
}
