
"use client"

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Clapperboard, Heart, Sparkles, MessageSquare, Gem, List, Plus, X, UserX, AlertCircle, Bot, Minimize2, Maximize2 } from "lucide-react"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, AreaChart, Area } from "recharts"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TwitchIcon, YouTubeIcon, KickIcon, TikTokIcon, DiscordIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ChatClient } from "./chat-client";
import { Button } from "@/components/ui/button";
import { VoiceCommander } from "./voice-commander";
import { FlowRunViewer } from "@/components/flow/flow-run-viewer";
import AudioRouter from '@/components/audio-router';

const initialChartData = [
  { month: "January", commands: 186, user: 10 },
  { month: "February", commands: 305, user: 20 },
  { month: "March", commands: 237, user: 15 },
  { month: "April", commands: 273, user: 25 },
  { month: "May", commands: 209, user: 18 },
  { month: "June", commands: 214, user: 22 },
]

const initialAreaChartData = [
    { date: "2024-01-01", shoutouts: 20, user: 5 },
    { date: "2024-01-02", shoutouts: 15, user: 3 },
    { date: "2024-01-03", shoutouts: 25, user: 8 },
    { date: "2024-01-04", shoutouts: 22, user: 4 },
    { date: "2024-01-05", shoutouts: 30, user: 6 },
    { date: "2024-01-06", shoutouts: 28, user: 7 },
    { date: "2024-01-07", shoutouts: 35, user: 9 },
]

const chartConfig = {
  commands: { label: "Commands", color: "hsl(var(--accent))" },
  user: { label: "User", color: "hsl(var(--primary))" },
}

const areaChartConfig = {
    shoutouts: { label: "Shoutouts", color: "hsl(var(--primary))" },
    user: { label: "User", color: "hsl(var(--accent))" },
}

const platformIcons = {
  Twitch: TwitchIcon,
  YouTube: YouTubeIcon,
  Kick: KickIcon,
  TikTok: TikTokIcon,
  Discord: DiscordIcon,
};

const iconComponents: { [key: string]: React.ElementType } = {
  MessageSquare,
  Sparkles,
  Users,
  Heart,
  Gem,
  Clapperboard,
  Bot
};

interface DashboardClientProps {
    allMetrics: any[];
    allViewers: any[];
    selectedPlatform: string;
    setSelectedPlatform: (platform: string) => void;
}

import { DiscordChannelSettings } from "@/components/discord-channel-settings";

export function DashboardClient({ allMetrics, allViewers, selectedPlatform, setSelectedPlatform }: DashboardClientProps) {
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [chartData, setChartData] = useState(initialChartData);
  const [areaData, setAreaData] = useState(initialAreaChartData);
  const [hideInactive, setHideInactive] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [minimizedComponents, setMinimizedComponents] = useState<Set<string>>(new Set());

  // We can't add/remove metrics now since they are live, but we keep the structure.
  // In the future, this could control which metrics are fetched.
  const [displayedMetricIds] = useState(['totalCommands', 'shoutoutsGiven', 'activeViewers', 'athenaCommands']);
  
  const displayedMetrics = displayedMetricIds.map(id => allMetrics.find(m => m.id === id)).filter(Boolean);
  
  const handleUserSelect = (user: any) => {
    if (selectedUser?.name === user.name) {
      setSelectedUser(null);
      setChartData(initialChartData);
      setAreaData(initialAreaChartData);
    } else {
      setSelectedUser(user);
      // Generate mock data for the selected user
      setChartData(initialChartData.map(d => ({ ...d, user: Math.floor(Math.random() * 50) + 1 })));
      setAreaData(initialAreaChartData.map(d => ({ ...d, user: Math.floor(Math.random() * 10) + 1 })));
    }
  };
  
  const clearSelectedUser = () => {
    setSelectedUser(null);
    setChartData(initialChartData);
    setAreaData(initialAreaChartData);
  }

  const toggleMinimize = (componentId: string) => {
    setMinimizedComponents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(componentId)) {
        newSet.delete(componentId);
      } else {
        newSet.add(componentId);
      }
      return newSet;
    });
  };

  // Filter viewers based on platform and activity
  const filteredViewers = allViewers.filter(viewer => {
    const platformMatch = selectedPlatform === "Twitch" || viewer.platform === selectedPlatform;
    const activityMatch = !hideInactive || viewer.active;
    return platformMatch && activityMatch;
  });
  
  const getFollowDuration = (date: string | null) => {
    if (!date) return "Not a follower";
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="relative">
          <Button 
            variant="ghost" 
            size="icon" 
            className="absolute top-2 right-2 h-6 w-6 z-10" 
            onClick={() => toggleMinimize('voice')}
          >
            {minimizedComponents.has('voice') ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </Button>
          {!minimizedComponents.has('voice') ? (
            <div className="space-y-4">
              <VoiceCommander />
              <AudioRouter />
            </div>
          ) : (
            <CardHeader>
              <CardTitle>Voice Commander (Minimized)</CardTitle>
              <CardDescription>Click maximize to restore</CardDescription>
            </CardHeader>
          )}
        </Card>
        <DiscordChannelSettings />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="relative">
          <Button 
            variant="ghost" 
            size="icon" 
            className="absolute top-2 right-2 h-6 w-6 z-10" 
            onClick={() => toggleMinimize('flow')}
          >
            {minimizedComponents.has('flow') ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </Button>
          {!minimizedComponents.has('flow') ? (
            <FlowRunViewer />
          ) : (
            <CardHeader>
              <CardTitle>Flow Run Viewer (Minimized)</CardTitle>
              <CardDescription>Click maximize to restore</CardDescription>
            </CardHeader>
          )}
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {selectedUser ? (
          <>
            <Card className="relative">
             <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={clearSelectedUser}>
                <UserX className="h-4 w-4 text-muted-foreground" />
              </Button>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Commands Run</CardTitle>
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{selectedUser.commandsRun}</div>
                <p className="text-xs text-muted-foreground">Total commands by {selectedUser.name}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Shoutouts Received</CardTitle>
                <Sparkles className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{selectedUser.shoutouts}</div>
                <p className="text-xs text-muted-foreground">Times user has been shouted out</p>
              </CardContent>
            </Card>
             <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Bits & Cheers</CardTitle>
                <Gem className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{selectedUser.bits.toLocaleString()}</div>
                 <p className="text-xs text-muted-foreground">Followed {getFollowDuration(selectedUser.followDate)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Last Seen</CardTitle>
                <Clapperboard className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatDistanceToNow(new Date(selectedUser.lastSeen), { addSuffix: true })}</div>
                <p className="text-xs text-muted-foreground">Watching for {selectedUser.watchTime}</p>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            {displayedMetrics.map(metric => {
              if (!metric) return null;
              const Icon = iconComponents[metric.icon];
              return (
                <Card key={metric.id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
                    {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metric.value}</div>
                    <p className="text-xs text-muted-foreground">{metric.description}</p>
                  </CardContent>
                </Card>
              )
            })}
          </>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <div className="lg:col-span-5 grid grid-cols-1 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{selectedUser ? `${selectedUser.name}'s Command Usage` : 'Global Command Usage'}</CardTitle>
                <CardDescription>
                {selectedUser
                  ? `Monthly command usage for ${selectedUser.name}.`
                  : "Total commands executed by all users per month."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
              <ChartContainer config={chartConfig} className="h-[250px] w-full">
                <BarChart accessibilityLayer data={chartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    tickMargin={10}
                    axisLine={false}
                    tickFormatter={(value) => value.slice(0, 3)}
                  />
                    <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey={selectedUser ? 'user' : 'commands'} fill={selectedUser ? 'var(--color-user)' : 'var(--color-commands)'} radius={4} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{selectedUser ? `${selectedUser.name}'s Shoutout History` : 'Global Shoutout Trends'}</CardTitle>
              <CardDescription>
                {selectedUser
                  ? `Shoutouts received by ${selectedUser.name} over time.`
                  : "Total shoutouts given to all users over time."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
            <ChartContainer config={areaChartConfig} className="h-[250px] w-full">
              <AreaChart accessibilityLayer data={areaData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value) => {
                          const date = new Date(value)
                          return date.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          })
                      }}
                    />
                    <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                  <Area
                      dataKey={selectedUser ? 'user' : 'shoutouts'}
                      type="natural"
                      fill={selectedUser ? 'var(--color-user)' : 'var(--color-shoutouts)'}
                      fillOpacity={0.4}
                      stroke={selectedUser ? 'var(--color-user)' : 'var(--color-shoutouts)'}
                    />
              </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2 grid grid-rows-2 gap-4 auto-rows-fr">
            <Card className="flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div className="space-y-1">
                        <CardTitle>Viewer List</CardTitle>
                        <CardDescription>Select a viewer to see their stats.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col min-h-0">
                    <div className="flex flex-col h-full">
                    <div className="flex flex-col space-y-2 pb-4">
                        <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select Platform" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Twitch">Twitch</SelectItem>
                                <SelectItem value="Discord">Discord</SelectItem>
                            </SelectContent>
                        </Select>
                        <div className="flex items-center space-x-2">
                            <Switch id="hide-inactive" checked={hideInactive} onCheckedChange={setHideInactive} />
                            <Label htmlFor="hide-inactive">Hide Inactive</Label>
                        </div>
                    </div>
                    <ScrollArea className="flex-1">
                      {allViewers.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            {filteredViewers.map(viewer => {
                                const PlatformIcon = platformIcons[viewer.platform as keyof typeof platformIcons];
                                return (
                                    <button 
                                        key={viewer.id} 
                                        onClick={() => handleUserSelect(viewer)}
                                        className={cn(
                                            "flex items-center gap-3 p-2 rounded-md text-left w-full hover:bg-muted",
                                            selectedUser?.name === viewer.name && "bg-muted"
                                        )}
                                    >
                                        <Avatar className="h-8 w-8">
                                            <AvatarImage src={viewer.avatar} alt={viewer.name} data-ai-hint="user avatar" />
                                            <AvatarFallback>{viewer.name?.charAt(0) || '?'}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium">{viewer.name}</p>
                                            <p className="text-xs text-muted-foreground">{viewer.platform}</p>
                                        </div>
                                        {PlatformIcon && <PlatformIcon className="h-4 w-4 text-muted-foreground" />}
                                    </button>
                                )
                            })}
                        </div>
                      ) : (
                         <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
                            <AlertCircle className="h-8 w-8 mb-2" />
                            <p className="text-sm font-medium">Could not fetch viewers.</p>
                            <p className="text-xs">Ensure your stream is live and credentials in your `.env` file are correct.</p>
                        </div>
                      )}
                    </ScrollArea>
                    </div>
                </CardContent>
            </Card>
            <div className="relative">
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute top-2 right-2 h-6 w-6 z-10" 
                onClick={() => toggleMinimize('chat')}
              >
                {minimizedComponents.has('chat') ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
              </Button>
              {!minimizedComponents.has('chat') ? (
                <ChatClient />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Live Chat (Minimized)</CardTitle>
                    <CardDescription>Click maximize to restore chat</CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
        </div>
      </div>
    </div>
  )
}
