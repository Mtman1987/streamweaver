"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { ChevronRight, Loader2, MoreHorizontal, PlusCircle, Zap, Play, Pause, Settings, Search } from "lucide-react";
import { useActionsData } from "@/hooks/use-actions-data";
import { useToast } from "@/hooks/use-toast";
import { deleteActionClient, duplicateActionClient, runActionClient, updateActionClient } from "@/lib/client-actions";

type ActionRow = {
  id: string;
  name: string;
  group?: string;
  enabled: boolean;
  triggers?: any[];
  subActions?: any[];
};

type SortMode = "group" | "name" | "status" | "steps";

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function normalizeActionGroup(action: ActionRow): string {
  const raw = String(action.group || "").trim();
  const text = `${raw} ${action.name || ""}`.toLowerCase();

  if (raw && raw.toLowerCase() !== "ungrouped") return raw;
  if (text.includes("streamup") || text.includes("point") || text.includes("gamble") || text.includes("leader")) return "Currency";
  if (text.includes("mod") || text.includes("set") || text.includes("reset") || text.includes("give")) return "Moderation";
  if (text.includes("cuddle") || text.includes("hug") || text.includes("dance") || text.includes("highfive") || text.includes("fistbump") || text.includes("headpat") || text.includes("love") || text.includes("lurk")) return "Chat Actions";
  if (text.includes("follow") || text.includes("raid") || text.includes("shoutout")) return "Stream Info";
  if (text.includes("ai") || text.includes("athena") || text.includes("voice")) return "AI & Voice";
  if (text.includes("obs") || text.includes("overlay") || text.includes("scene")) return "Overlays & OBS";
  return "Ungrouped";
}

function triggerLabel(trigger: any): string {
  const value = String(trigger?.type ?? "").trim();
  if (!value) return "Trigger";
  if (value === "0") return "Command";
  if (value === "1") return "Chat message";
  if (value === "4") return "Follow";
  if (value === "9") return "Raid";
  return value;
}

export default function ActionsPage() {
  const { actions, isLoading, error, refresh } = useActionsData();
  const { toast } = useToast();
  const [skipShoutoutOverlay, setSkipShoutoutOverlay] = useState(false);
  const [isSavingShoutoutMode, setIsSavingShoutoutMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("group");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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
    fetch('/api/bot-settings').then(r => r.ok ? r.json() : null).then(payload => {
      setSkipShoutoutOverlay(payload?.skipShoutoutOverlay === true);
    }).catch(() => {});
  }, []);

  const handleToggleShoutoutMode = async (checked: boolean) => {
    setSkipShoutoutOverlay(checked);
    setIsSavingShoutoutMode(true);
    try {
      const response = await fetch("/api/bot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipShoutoutOverlay: checked }),
      });
      if (!response.ok) throw new Error('Server rejected the setting');
      toast({
        title: checked ? "Single-message shoutouts enabled" : "Overlay shoutouts enabled",
      });
    } catch (e: any) {
      setSkipShoutoutOverlay(!checked);
      toast({
        variant: "destructive",
        title: "Failed to save shoutout mode",
        description: e?.message || String(e),
      });
    } finally {
      setIsSavingShoutoutMode(false);
    }
  };

  const handleRunAction = async (id: string) => {
    try {
      const result = await runActionClient(id);
      toast({
        title: result.success ? "Action ran" : "Action finished with failures",
        description: result.actionName,
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Run failed", description: e?.message || String(e) });
    }
  };

  const handleDuplicateAction = async (id: string) => {
    try {
      const duplicated = await duplicateActionClient(id);
      toast({ title: "Action duplicated", description: duplicated.name });
      await refresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Duplicate failed", description: e?.message || String(e) });
    }
  };

  const handleToggleAction = async (id: string, enabled: boolean) => {
    try {
      await updateActionClient(id, { enabled });
      toast({ title: enabled ? "Action enabled" : "Action disabled" });
      await refresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Toggle failed", description: e?.message || String(e) });
    }
  };

  const handleDeleteAction = async (id: string) => {
    const ok = window.confirm("Delete this action?");
    if (!ok) return;
    try {
      await deleteActionClient(id);
      toast({ title: "Action deleted" });
      await refresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete failed", description: e?.message || String(e) });
    }
  };

  const toggleGroup = (group: string) => {
    setOpenGroups((current) => ({ ...current, [group]: !current[group] }));
  };

  const enabledCount = actions.filter((action) => action.enabled).length;
  const triggerCount = actions.reduce((count, action) => count + (action.triggers?.length || 0), 0);
  const subActionCount = actions.reduce((count, action) => count + (action.subActions?.length || 0), 0);
  const normalizedActions = actions as ActionRow[];
  const availableGroups = Array.from(new Set(normalizedActions.map(normalizeActionGroup))).sort(compareText);
  const filteredActions = normalizedActions
    .filter((action) => {
      const group = normalizeActionGroup(action);
      const query = searchQuery.trim().toLowerCase();
      const haystack = [
        action.name,
        action.group,
        group,
        ...(Array.isArray(action.triggers) ? action.triggers.map(triggerLabel) : []),
      ].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (groupFilter !== "all" && group !== groupFilter) return false;
      if (statusFilter === "enabled" && !action.enabled) return false;
      if (statusFilter === "disabled" && action.enabled) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "status" && a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      if (sortMode === "steps") return (b.subActions?.length || 0) - (a.subActions?.length || 0);
      if (sortMode === "name") return compareText(a.name || "", b.name || "");
      const groupCompare = compareText(normalizeActionGroup(a), normalizeActionGroup(b));
      if (groupCompare !== 0) return groupCompare;
      return compareText(a.name || "", b.name || "");
    });
  const groupedActions = availableGroups
    .map((group) => ({
      group,
      actions: filteredActions.filter((action) => normalizeActionGroup(action) === group),
      total: normalizedActions.filter((action) => normalizeActionGroup(action) === group).length,
    }))
    .filter((section) => section.actions.length > 0);

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
              <p className="text-sm text-muted-foreground">Grouped and sorted so imported action chains are easier to scan.</p>
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
          <div className="grid gap-3 border-b border-border/70 px-6 py-4 lg:grid-cols-[1fr_180px_180px_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search actions, triggers, or groups"
                className="pl-9"
              />
            </div>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {availableGroups.map((group) => (
                  <SelectItem key={group} value={group}>{group}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="enabled">Enabled only</SelectItem>
                <SelectItem value="disabled">Disabled only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
              <SelectTrigger>
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="group">Group, then name</SelectItem>
                <SelectItem value="name">Name A-Z</SelectItem>
                <SelectItem value="status">Enabled first</SelectItem>
                <SelectItem value="steps">Most steps first</SelectItem>
              </SelectContent>
            </Select>
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
                {!isLoading && actions.length > 0 && filteredActions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      <div className="py-8">
                        <div className="text-sm font-medium text-foreground">No actions match those filters.</div>
                        <div className="mt-1 text-sm text-muted-foreground">Try a different search, group, or status.</div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {groupedActions.map((section) => (
                  <Fragment key={section.group}>
                    <TableRow className="bg-muted/35 hover:bg-muted/50">
                      <TableCell colSpan={5} className="py-2">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 text-left"
                          onClick={() => toggleGroup(section.group)}
                        >
                          <span className="flex items-center gap-2">
                            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${openGroups[section.group] ? "rotate-90" : ""}`} />
                            <span className="font-medium">{section.group}</span>
                          </span>
                          <Badge variant="outline">{section.actions.length}/{section.total}</Badge>
                        </button>
                      </TableCell>
                    </TableRow>
                    {openGroups[section.group] ? section.actions.map((action) => (
                  <TableRow key={action.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {action.enabled ? <Play className="h-4 w-4 text-accent" /> : <Pause className="h-4 w-4 text-muted-foreground" />}
                        <span>{action.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(action.triggers?.length || 0) === 0 ? (
                          <Badge variant="outline">No triggers</Badge>
                        ) : (
                          action.triggers?.map((trigger, i) => (
                            <Badge key={i} variant="outline">{triggerLabel(trigger)}</Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-muted-foreground" />
                        <span>{action.subActions?.length || 0} sub-actions</span>
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
                          <DropdownMenuItem onClick={() => handleRunAction(action.id)}>
                            <Play className="mr-2 h-4 w-4" />
                            Run
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={refresh}>Refresh</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicateAction(action.id)}>Duplicate</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleAction(action.id, !action.enabled)}>
                            {action.enabled ? "Disable" : "Enable"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteAction(action.id)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                    )) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
