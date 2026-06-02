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
import { Loader2, MoreHorizontal, PlusCircle, Play, BarChart2 } from "lucide-react";
import { useCommandsData } from "@/hooks/use-commands-data";
import { useToast } from "@/hooks/use-toast";
import { deleteCommandClient, updateAllCommandsEnabledClient, updateCommandClient } from "@/lib/client-commands";

export default function CommandsPage() {
  const { commands, isLoading, error, refresh } = useCommandsData();
  const { toast } = useToast();
  const [pendingCommandIds, setPendingCommandIds] = useState<string[]>([]);
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [skipShoutoutOverlay, setSkipShoutoutOverlay] = useState(false);
  const [isSavingShoutoutMode, setIsSavingShoutoutMode] = useState(false);

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
    const saved = localStorage.getItem("skip_shoutout_overlay");
    setSkipShoutoutOverlay(saved === "true");
  }, []);

  const handleRunCommand = (commandName: string) => {
    toast({
      title: "Command Triggered",
      description: `The command "${commandName}" is being executed.`,
    });
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

  const enabledCount = commands.filter((command) => command.enabled).length;
  const disabledCount = commands.length - enabledCount;
  const groupedCount = new Set(commands.map((command) => (command.group ?? "").trim() || "Ungrouped")).size;

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
              <p className="text-sm text-muted-foreground">Edit triggers, enable or disable commands, and keep the set tidy.</p>
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <div className="flex items-center justify-between rounded-full border border-border/70 bg-background/40 px-3 py-1.5 text-xs text-muted-foreground">
                <span className="mr-2 h-2 w-2 rounded-full bg-accent" />
                Overlay shoutouts {skipShoutoutOverlay ? "on" : "off"}
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
                {commands.map((command) => (
                  <TableRow key={command.id}>
                    <TableCell className="font-medium">
                      <div className="space-y-1">
                        <div>{(command.name ?? '').trim() || (command.command ?? '').trim() || 'Untitled Command'}</div>
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
                      <Badge variant="outline">{(command.group ?? '').trim() || "Ungrouped"}</Badge>
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
                          <DropdownMenuItem onClick={() => handleRunCommand(command.name)}>
                            <Play className="mr-2 h-4 w-4" />
                            Run
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled>
                            <BarChart2 className="mr-2 h-4 w-4" />
                            Track
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link href={`/commands/${encodeURIComponent(command.id)}/edit`}>Edit</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
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
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
