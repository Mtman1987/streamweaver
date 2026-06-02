"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, MoreHorizontal, PlusCircle, Zap, Play, Pause, Settings } from "lucide-react";
import { useActionsData } from "@/hooks/use-actions-data";
import { useToast } from "@/hooks/use-toast";

export default function ActionsPage() {
  const { actions, isLoading, error, refresh } = useActionsData();
  const { toast } = useToast();
  const [skipShoutoutOverlay, setSkipShoutoutOverlay] = useState(false);
  const [isSavingShoutoutMode, setIsSavingShoutoutMode] = useState(false);

  useEffect(() => {
    if (error) {
      toast({
        variant: "destructive",
        title: "Failed to load actions",
        description: error,
      });
    }
  }, [error, toast]);

  useEffect(() => {
    const saved = localStorage.getItem("skip_shoutout_overlay");
    setSkipShoutoutOverlay(saved === "true");
  }, []);

  const handleToggleShoutoutMode = async (checked: boolean) => {
    setSkipShoutoutOverlay(checked);
    setIsSavingShoutoutMode(true);
    localStorage.setItem("skip_shoutout_overlay", checked ? "true" : "false");
    try {
      await fetch("/api/bot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipShoutoutOverlay: checked }),
      });
      toast({
        title: checked ? "Single-message shoutouts enabled" : "Overlay shoutouts enabled",
      });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Failed to save shoutout mode",
        description: e?.message || String(e),
      });
    } finally {
      setIsSavingShoutoutMode(false);
    }
  };

  const enabledCount = actions.filter((action) => action.enabled).length;
  const triggerCount = actions.reduce((count, action) => count + (action.triggers?.length || 0), 0);
  const subActionCount = actions.reduce((count, action) => count + (action.subActions?.length || 0), 0);

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/85 shadow-sm">
        <CardContent className="grid gap-6 px-6 py-6 lg:grid-cols-[1.4fr_0.95fr] lg:items-start">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-accent/15 text-accent hover:bg-accent/15">Automation builder</Badge>
              <Badge variant="outline" className="border-border/70 bg-background/50 text-muted-foreground">
                {actions.length} total
              </Badge>
              <Badge variant="outline" className="border-border/70 bg-background/50 text-muted-foreground">
                {enabledCount} enabled
              </Badge>
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight">Actions that do the heavy lifting.</h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Actions are the engine room. Build once, attach to many triggers, and keep the logic readable so future changes are obvious.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={refresh}>
                Refresh
              </Button>
              <Button asChild variant="outline">
                <Link href="/community" className="gap-2">
                  <PlusCircle className="h-3.5 w-3.5" />
                  Import from community
                </Link>
              </Button>
              <Button asChild>
                <Link href="/actions/new" className="gap-2">
                  <PlusCircle className="h-3.5 w-3.5" />
                  Create action
                </Link>
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-3xl border border-border/70 bg-background/40 p-4 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Workflow note</div>
                <div className="mt-1 text-sm font-medium">Triggers point to actions</div>
              </div>
              <div className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">One source</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/70 bg-card/70 p-3">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Triggers</div>
                <div className="mt-1 text-lg font-semibold">{triggerCount}</div>
                <div className="text-xs text-muted-foreground">Where the action starts.</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card/70 p-3">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Sub-actions</div>
                <div className="mt-1 text-lg font-semibold">{subActionCount}</div>
                <div className="text-xs text-muted-foreground">Steps inside the flow.</div>
              </div>
            </div>
            <div className="rounded-2xl border border-accent/20 bg-accent/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-accent">
                <Zap className="h-4 w-4" />
                Keep it user-friendly
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Give every action a name that sounds like what it does, not how it was built.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/70 bg-card/80">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Enabled</div>
            <div className="mt-2 text-2xl font-semibold">{enabledCount}</div>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/80">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Triggers</div>
            <div className="mt-2 text-2xl font-semibold">{triggerCount}</div>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/80">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Sub-actions</div>
            <div className="mt-2 text-2xl font-semibold">{subActionCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 bg-card/80 shadow-sm">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-6 py-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold tracking-tight">Action list</h3>
              <p className="text-sm text-muted-foreground">Each action can have multiple triggers and a full sub-action chain.</p>
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <div className="flex items-center justify-between rounded-full border border-border/70 bg-background/40 px-3 py-1.5 text-xs text-muted-foreground">
                <span className="mr-2 h-2 w-2 rounded-full bg-accent" />
                Shoutout overlay {skipShoutoutOverlay ? "off" : "on"}
              </div>
              <Switch
                checked={skipShoutoutOverlay}
                onCheckedChange={handleToggleShoutoutMode}
                disabled={isSavingShoutoutMode}
                aria-label="Toggle skip shoutout overlay"
              />
            </div>
          </div>
          <div className="px-6 py-4 md:hidden">
            <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/40 px-3 py-2">
              <div>
                <div className="text-sm font-medium">Skip shoutout overlay</div>
                <div className="text-xs text-muted-foreground">Use one bot message instead.</div>
              </div>
              <Switch
                checked={skipShoutoutOverlay}
                onCheckedChange={handleToggleShoutoutMode}
                disabled={isSavingShoutoutMode}
                aria-label="Toggle skip shoutout overlay"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Triggers</TableHead>
                  <TableHead>Sub-actions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      <div className="flex items-center justify-center gap-2 py-8">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading actions...
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && actions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      <div className="py-8">
                        <div className="text-sm font-medium text-foreground">No actions yet.</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          Create an action, add triggers, and attach sub-actions to bring it to life.
                        </div>
                        <div className="mt-4 flex items-center justify-center gap-2">
                          <Button asChild variant="outline">
                            <Link href="/community" className="gap-2">
                              <PlusCircle className="h-3.5 w-3.5" />
                              Import from community
                            </Link>
                          </Button>
                          <Button asChild>
                            <Link href="/actions/new" className="gap-2">
                              <PlusCircle className="h-3.5 w-3.5" />
                              Create action
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {actions.map((action) => (
                  <TableRow key={action.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {action.enabled ? <Play className="h-4 w-4 text-accent" /> : <Pause className="h-4 w-4 text-muted-foreground" />}
                        <span>{action.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {action.triggers.length === 0 ? (
                          <Badge variant="outline">No triggers</Badge>
                        ) : (
                          action.triggers.map((trigger, i) => (
                            <Badge key={i} variant="outline">{trigger.type}</Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-muted-foreground" />
                        <span>{action.subActions.length} sub-actions</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={action.enabled ? "default" : "secondary"} className={action.enabled ? "bg-green-600" : ""}>
                        {action.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button aria-haspopup="true" size="icon" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Toggle menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem asChild>
                            <Link href={`/active-commands?actionId=${encodeURIComponent(action.id)}`}>
                              <Settings className="mr-2 h-4 w-4" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={refresh}>Refresh</DropdownMenuItem>
                          <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
                          <DropdownMenuItem disabled>{action.enabled ? "Disable" : "Enable"}</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" disabled>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
