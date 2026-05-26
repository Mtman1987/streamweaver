"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Bot, Plus, X, Loader2 } from "lucide-react"

export function BotBlacklist() {
  const [bots, setBots] = useState<string[]>([])
  const [customBots, setCustomBots] = useState<string[]>([])
  const [athenaUsers, setAthenaUsers] = useState<string[]>([])
  const [newBot, setNewBot] = useState("")
  const [newAthenaUser, setNewAthenaUser] = useState("")
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [addingAthenaUser, setAddingAthenaUser] = useState(false)

  const fetchBots = async () => {
    try {
      const [botsRes, athenaRes] = await Promise.all([
        fetch("/api/known-bots"),
        fetch("/api/athena-whitelist"),
      ])
      if (botsRes.ok) {
        const data = await botsRes.json()
        setBots(data.bots || [])
        setCustomBots(data.custom || [])
      }
      if (athenaRes.ok) {
        const data = await athenaRes.json()
        setAthenaUsers(data.users || [])
      }
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { fetchBots() }, [])

  const addBot = async () => {
    const name = newBot.trim().toLowerCase().replace(/^@/, "")
    if (!name) return
    setAdding(true)
    try {
      const res = await fetch("/api/known-bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
      })
      if (res.ok) {
        setNewBot("")
        await fetchBots()
      }
    } catch {} finally { setAdding(false) }
  }

  const removeBot = async (name: string) => {
    try {
      await fetch("/api/known-bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name, action: "remove" }),
      })
      await fetchBots()
    } catch {}
  }

  const addAthenaUser = async () => {
    const name = newAthenaUser.trim().toLowerCase().replace(/^@/, "")
    if (!name) return
    setAddingAthenaUser(true)
    try {
      const res = await fetch("/api/athena-whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
      })
      if (res.ok) {
        setNewAthenaUser("")
        await fetchBots()
      }
    } catch {} finally { setAddingAthenaUser(false) }
  }

  const removeAthenaUser = async (name: string) => {
    try {
      await fetch("/api/athena-whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name, action: "remove" }),
      })
      await fetchBots()
    } catch {}
  }

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4" /> Bot Blacklist
        </CardTitle>
        <CardDescription className="text-xs">
          Ignored for welcome, shoutouts, points &amp; check-ins. Use !ignore in chat too.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 min-h-0">
        <div className="space-y-2 border-b pb-3">
          <div>
            <p className="text-xs font-medium">Athena whitelist</p>
            <p className="text-[11px] text-muted-foreground">Only these users, plus Mtman1987, can make Athena answer in tracked Twitch chats.</p>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="username"
              value={newAthenaUser}
              onChange={(e) => setNewAthenaUser(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAthenaUser()}
              className="h-8 text-sm"
            />
            <Button size="sm" className="h-8 px-2" onClick={addAthenaUser} disabled={addingAthenaUser || !newAthenaUser.trim()}>
              {addingAthenaUser ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            </Button>
          </div>
          <div className="space-y-1">
            {athenaUsers.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground italic">No extra users whitelisted.</p>
            ) : athenaUsers.map((user) => (
              <div key={user} className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted group">
                <span className="text-sm">{user}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={() => removeAthenaUser(user)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium">Bot blacklist</p>
          <p className="text-[11px] text-muted-foreground">Ignored for welcome, shoutouts, points &amp; check-ins. Use !ignore in chat too.</p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="username"
            value={newBot}
            onChange={(e) => setNewBot(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addBot()}
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8 px-2" onClick={addBot} disabled={adding || !newBot.trim()}>
            {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          </Button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-4 text-muted-foreground text-xs">Loading...</div>
        ) : (
          <ScrollArea className="flex-1 max-h-[260px]">
            <div className="space-y-1">
              {customBots.length > 0 && (
                <>
                  <p className="text-[10px] uppercase text-muted-foreground font-medium tracking-wider px-1">Custom ({customBots.length})</p>
                  {customBots.map((bot) => (
                    <div key={bot} className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted group">
                      <span className="text-sm">{bot}</span>
                      <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={() => removeBot(bot)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </>
              )}
              <p className="text-[10px] uppercase text-muted-foreground font-medium tracking-wider px-1 pt-2">Defaults ({bots.length - customBots.length})</p>
              {bots.filter(b => !customBots.includes(b)).slice(0, 30).map((bot) => (
                <div key={bot} className="px-2 py-0.5 text-sm text-muted-foreground">{bot}</div>
              ))}
              {bots.length - customBots.length > 30 && (
                <div className="px-2 py-0.5 text-xs text-muted-foreground italic">...and {bots.length - customBots.length - 30} more</div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
