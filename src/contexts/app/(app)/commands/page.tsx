"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { deleteCommandClient } from "@/lib/client-commands";

export default function CommandsPage() {
  const { commands, isLoading, error, refresh } = useCommandsData();
  const { toast } = useToast();

  useEffect(() => {
    if (error) {
      toast({
        variant: "destructive",
        title: "Failed to load commands",
        description: error,
      });
    }
  }, [error, toast]);

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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Commands</CardTitle>
          <CardDescription>Manage and create custom stream commands.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            Refresh
          </Button>
          <Button asChild size="sm" className="gap-1">
            <Link href="/commands/new">
              <PlusCircle className="h-3.5 w-3.5" />
              Create Command
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Command Name</TableHead>
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
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading commands...
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!isLoading && commands.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No commands yet. Create an action to register a command.
                </TableCell>
              </TableRow>
            )}
            {commands.map((command) => (
              <TableRow key={command.id}>
                <TableCell className="font-medium">
                  {(command.name ?? '').trim() || (command.command ?? '').trim() || 'Untitled Command'}
                </TableCell>
                <TableCell>
                  <div className="font-mono text-sm">
                    {(command.command ?? '').trim() || '—'}
                  </div>
                  {command.aliases && command.aliases.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Aliases: {command.aliases.join(', ')}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{(command.group ?? '').trim() || "—"}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={command.enabled ? "default" : "secondary"}
                    className={command.enabled ? "bg-green-600" : ""}
                  >
                    {command.enabled ? "Enabled" : "Disabled"}
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
      </CardContent>
    </Card>
  );
}
