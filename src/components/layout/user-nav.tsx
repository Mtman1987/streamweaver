
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
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { UserProfile } from "@/app/(app)/layout"
import { Bot, User } from "lucide-react"

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
          <DropdownMenuItem>
            Profile
            <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Settings
            <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          Log out
          <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
