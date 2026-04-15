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
import { Loader2, MoreHorizontal, PlusCircle, Zap, Play, Pause, Settings } from "lucide-react";
import { useActionsData } from "@/hooks/use-actions-data";
import { useToast } from "@/hooks/use-toast";

export default function ActionsPage() {
  const { actions, isLoading, error, refresh } = useActionsData();
  const { toast } = useToast();

  useEffect(() => {
    if (error) {
      toast({
        variant: "destructive",
        title: "Failed to load actions",
        description: error,
      });
    }
  }, [error, toast]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Actions</CardTitle>
          <CardDescription>Create flexible automation with multiple triggers and sub-actions, just like Streamer.bot.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="gap-1">
            <Link href="/community">
              <PlusCircle className="h-3.5 w-3.5" />
              Import from Community
            </Link>
          </Button>
          <Button asChild size="sm" className="gap-1">
            <Link href="/actions/new">
              <PlusCircle className="h-3.5 w-3.5" />
              Create Action
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action Name</TableHead>
              <TableHead>Triggers</TableHead>
              <TableHead>Sub-Actions</TableHead>
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
                    Loading actions...
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!isLoading && actions.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No actions yet. Create your first action to get started.
                </TableCell>
              </TableRow>
            )}
            {actions.map((action) => (
              <TableRow key={action.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {action.enabled ? <Play className="h-4 w-4 text-green-600" /> : <Pause className="h-4 w-4 text-gray-400" />}
                    {action.name}
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
                          <Settings className="h-4 w-4 mr-2" />
                          Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={refresh}>Refresh</DropdownMenuItem>
                      <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
                      <DropdownMenuItem disabled>
                        {action.enabled ? "Disable" : "Enable"}
                      </DropdownMenuItem>
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
      </CardContent>
    </Card>
  );
}