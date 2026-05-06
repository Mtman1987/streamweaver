
"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import Link from "next/link"
import type { UserProfile } from "./app-shell"
import { Bot, User, LogOut } from "lucide-react"

interface UserNavProps {
  userProfile: UserProfile;
}

export function UserNav({ userProfile }: UserNavProps) {
  const botName = process.env.NEXT_PUBLIC_TWITCH_BOT_USERNAME || "Bot";
  const twitchUser = userProfile.twitch;

  const displayName = twitchUser?.name || botName;
  const displayAvatar = twitchUser?.avatar;
  const description = twitchUser ? "Broadcaster" : "StreamWeave Bot";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-auto w-full justify-start gap-2 px-2 py-1">
          <Avatar className="h-10 w-10">
            {displayAvatar && <AvatarImage src={displayAvatar} alt={displayName} data-ai-hint="user avatar" />}
            <AvatarFallback>
              {twitchUser ? <User /> : <Bot />}
            </AvatarFallback>
          </Avatar>
           <div className="flex flex-col text-left">
            <p className="text-sm font-medium">{displayName}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
           </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{displayName}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {twitchUser ? `Logged in as ${displayName}` : 'Connected via backend'}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/settings">Settings</Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => { window.location.href = '/api/auth/signout'; }}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
