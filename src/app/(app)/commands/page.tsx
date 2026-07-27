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
import { ChevronRight, Loader2, MoreHorizontal, PlusCircle, Play, BarChart2, Search } from "lucide-react";
import { useCommandsData } from "@/hooks/use-commands-data";
import { useToast } from "@/hooks/use-toast";
import { deleteCommandClient, duplicateCommandClient, runCommandClient, updateAllCommandsEnabledClient, updateCommandClient } from "@/lib/client-commands";

type CommandRow = {
  id: string;
  name?: string;
  command?: string;
  description?: string;
  group?: string;
  aliases?: string[];
  enabled: boolean;
};

type SortMode = "group" | "trigger" | "name" | "status";

function normalizeTrigger(value: unknown): string {
  const trigger = String(value || "").trim();
  if (!trigger) return "";
  return trigger.startsWith("!") ? trigger : `!${trigger.replace(/^!+/, "")}`;
}

function commandTitle(command: CommandRow): string {
  const name = String(command.name || "").trim();
  const trigger = normalizeTrigger(command.command);
  if (!name) return trigger || "Untitled command";
  if (trigger && name.toLowerCase() === trigger.toLowerCase()) return trigger;
  return name;
}

function normalizeGroup(command: CommandRow): string {
  const raw = String(command.group || "").trim();
  const text = `${raw} ${command.name || ""} ${command.command || ""}`.toLowerCase();

  if (raw && raw.toLowerCase() !== "ungrouped") return raw;
  if (text.includes("streamup") || text.includes("point") || text.includes("gamble") || text.includes("leader")) return "Currency";
  if (text.includes("mod") || text.includes("set") || text.includes("reset") || text.includes("give")) return "Moderation";
  if (text.includes("cuddle") || text.includes("hug") || text.includes("dance") || text.includes("highfive") || text.includes("fistbump") || text.includes("headpat") || text.includes("love") || text.includes("lurk")) return "Chat Actions";
  if (text.includes("follow") || text.includes("raid") || text.includes("shoutout")) return "Stream Info";
  return "Ungrouped";
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export default function CommandsPage() {
  const { commands, isLoading, error, refresh } = useCommandsData();
  const { toast } = useToast();
  const [pendingCommandIds, setPendingCommandIds] = useState<string[]>([]);
  const [isBulkSaving, setIsBulkSaving] = useState(false);
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
        title: "Failed to load commands",
        description: error,
      });
    }
  }, [error, toast]);

  useEffect(() => {
    fetch('/api/bot-settings').then(r => r.ok ? r.json() : null).then(payload => {
      setSkipShoutoutOverlay(payload?.skipShoutoutOverlay === true);
    }).catch(() => {});
  }, []);

  const handleRunCommand = async (id: string) => {
    try {
      const result = await runCommandClient(id);
      toast({
        title: result.matchedActions > 0 ? "Command ran" : "No action attached",
        description:
          result.matchedActions > 0
            ? `${result.actionsRun} action${result.actionsRun === 1 ? "" : "s"} ran, ${result.actionsFailed} failed.`
            : "Attach this command to an action in Workflows.",
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Run failed", description: e?.message || String(e) });
    }
  };

  const handleDuplicateCommand = async (id: string) => {
    try {
      const duplicated = await duplicateCommandClient(id);
      toast({ title: "Command duplicated", description: `${duplicated.command} is disabled until you enable it.` });
      await refresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Duplicate failed", description: e?.message || String(e) });
    }
  };

  const handleDeleteCommand = async (id: string) => {
    const ok = window.confirm('Delete this command?');
    if (!ok) return;
    try {
      await deleteCommandClient(id);
      toast({ title: 'Command deleted' });
      await refresh();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: e?.message || String(e) });
    }
  };

  const handleToggleCommand = async (id: string, enabled: boolean) => {
    setPendingCommandIds((current) => [...current, id]);
    try {
      await updateCommandClient(id, { enabled });
      toast({
        title: enabled ? "Command enabled" : "Command disabled",
      });
      await refresh();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Toggle failed",
        description: e?.message || String(e),
      });
    } finally {
      setPendingCommandIds((current) => current.filter((value) => value !== id));
    }
  };

  const handleToggleAll = async (enabled: boolean) => {
    setIsBulkSaving(true);
    try {
      const result = await updateAllCommandsEnabledClient(enabled);
      toast({
        title: enabled ? "All commands enabled" : "All commands disabled",
        description: result.updated > 0 ? `${result.updated} command${result.updated === 1 ? "" : "s"} updated.` : "No commands needed changes.",
      });
      await refresh();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Bulk update failed",
        description: e?.message || String(e),
      });
    } finally {
      setIsBulkSaving(false);
    }
  };

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

  const toggleGroup = (group: string) => {
    setOpenGroups((current) => ({ ...current, [group]: !current[group] }));
  };

  const enabledCount = commands.filter((command) => command.enabled).length;
  const disabledCount = commands.length - enabledCount;
  const normalizedCommands = commands.map((command) => ({
    ...(command as CommandRow),
    command: normalizeTrigger((command as CommandRow).command),
  }));
  const availableGroups = Array.from(new Set(normalizedCommands.map(normalizeGroup))).sort(compareText);
  const groupedCount = availableGroups.length;
  const filteredCommands = normalizedCommands
    .filter((command) => {
      const group = normalizeGroup(command);
      const query = searchQuery.trim().toLowerCase();
      const haystack = [
        commandTitle(command),
        command.command,
        command.description,
        command.group,
        ...(Array.isArray(command.aliases) ? command.aliases : []),
      ].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (groupFilter !== "all" && group !== groupFilter) return false;
      if (statusFilter === "enabled" && !command.enabled) return false;
      if (statusFilter === "disabled" && command.enabled) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "status" && a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      if (sortMode === "name") return compareText(commandTitle(a), commandTitle(b));
      if (sortMode === "trigger") return compareText(a.command || "", b.command || "");
      const groupCompare = compareText(normalizeGroup(a), normalizeGroup(b));
      if (groupCompare !== 0) return groupCompare;
      return compareText(a.command || commandTitle(a), b.command || commandTitle(b));
    });
  const groupedCommands = availableGroups
    .map((group) => ({
      group,
      commands: filteredCommands.filter((command) => normalizeGroup(command) === group),
      total: normalizedCommands.filter((command) => normalizeGroup(command) === group).length,
    }))
    .filter((section) => section.commands.length > 0);

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/85 shadow-sm">
        <CardContent className="grid gap-6 px-6 py-6 lg:grid-cols-[1.4fr_0.95fr] lg:items-start">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-accent/15 text-accent hover:bg-accent/15">Command builder</Badge>
              <Badge variant="outline" className="border-border/70 bg-background/50 text-muted-foreground">
                {commands.length} total
              </Badge>
              <Badge variant="outline" className="border-border/70 bg-background/50 text-muted-foreground">
                {enabledCount} enabled
              </Badge>
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight">Commands that people can actually find.</h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Commands are the front door. Keep the trigger short, the name obvious, and the action chain hidden behind one clear click.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={refresh}>
                Refresh
              </Button>
              <Button variant="outline" onClick={() => handleToggleAll(true)} disabled={isBulkSaving || isLoading || commands.length === 0}>
                {isBulkSaving ? "Saving..." : "Enable all"}
              </Button>
              <Button variant="outline" onClick={() => handleToggleAll(false)} disabled={isBulkSaving || isLoading || commands.length === 0}>
                {isBulkSaving ? "Saving..." : "Disable all"}
              </Button>
              <Button asChild>
                <Link href="/commands/new" className="gap-2">
                  <PlusCircle className="h-3.5 w-3.5" />
                  Create command
                </Link>
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-3xl border border-border/70 bg-background/40 p-4 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Workflow note</div>
                <div className="mt-1 text-sm font-medium">Command then action</div>
              </div>
              <div className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">Simple path</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/70 bg-card/70 p-3">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Disabled</div>
                <div className="mt-1 text-lg font-semibold">{disabledCount}</div>
                <div className="text-xs text-muted-foreground">Ready to turn on later.</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card/70 p-3">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Groups</div>
                <div className="mt-1 text-lg font-semibold">{groupedCount}</div>
                <div className="text-xs text-muted-foreground">Useful for keeping things organized.</div>
              </div>
            </div>
            <div className="rounded-2xl border border-accent/20 bg-accent/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-accent">
                <BarChart2 className="h-4 w-4" />
                If it feels broken
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Start with the command trigger, then check whether an action is attached, then verify the action itself.
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
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Disabled</div>
            <div className="mt-2 text-2xl font-semibold">{disabledCount}</div>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/80">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Groups</div>
            <div className="mt-2 text-2xl font-semibold">{groupedCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 bg-card/80 shadow-sm">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-6 py-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold tracking-tight">Command list</h3>
              <p className="text-sm text-muted-foreground">Grouped and sorted so imported commands are easier to scan.</p>
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
                <div className="text-xs text-muted-foreground">Use a single bot message instead.</div>
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
                placeholder="Search commands, aliases, or descriptions"
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
                <SelectItem value="group">Group, then trigger</SelectItem>
                <SelectItem value="trigger">Trigger A-Z</SelectItem>
                <SelectItem value="name">Name A-Z</SelectItem>
                <SelectItem value="status">Enabled first</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Command</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Group</TableHead>
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
                        Loading commands...
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && commands.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      <div className="py-8">
                        <div className="text-sm font-medium text-foreground">No commands yet.</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          Create a command, give it a short trigger, and attach the behavior in Actions.
                        </div>
                        <div className="mt-4">
                          <Button asChild>
                            <Link href="/commands/new" className="gap-2">
                              <PlusCircle className="h-3.5 w-3.5" />
                              Create command
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && commands.length > 0 && filteredCommands.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      <div className="py-8">
                        <div className="text-sm font-medium text-foreground">No commands match those filters.</div>
                        <div className="mt-1 text-sm text-muted-foreground">Try a different search, group, or status.</div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {groupedCommands.map((section) => (
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
                          <Badge variant="outline">{section.commands.length}/{section.total}</Badge>
                        </button>
                      </TableCell>
                    </TableRow>
                    {openGroups[section.group] ? section.commands.map((command) => (
                  <TableRow key={command.id}>
                    <TableCell className="font-medium">
                      <div className="space-y-1">
                        <div>{commandTitle(command)}</div>
                        {(command.description as string | undefined) ? (
                          <div className="text-xs text-muted-foreground">{command.description}</div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-sm">{(command.command ?? '').trim() || '—'}</div>
                      {command.aliases && command.aliases.length > 0 && (
                        <div className="text-xs text-muted-foreground">Aliases: {command.aliases.join(", ")}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{normalizeGroup(command)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={command.enabled}
                          onCheckedChange={(checked) => handleToggleCommand(command.id, checked)}
                          disabled={pendingCommandIds.includes(command.id)}
                          aria-label={`Toggle ${(command.name ?? command.command ?? "command").trim() || "command"}`}
                        />
                        <Badge variant={command.enabled ? "default" : "secondary"} className={command.enabled ? "bg-green-600" : ""}>
                          {command.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                        {pendingCommandIds.includes(command.id) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      </div>
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
                          <DropdownMenuItem onClick={() => handleRunCommand(command.id)}>
                            <Play className="mr-2 h-4 w-4" />
                            Run
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link href={`/commands/${encodeURIComponent(command.id)}/edit`}>Edit</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicateCommand(command.id)}>Duplicate</DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteCommand(command.id)}
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
