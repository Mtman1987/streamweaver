"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createCommandClient, updateCommandClient } from "@/lib/client-commands";
import { useToast } from "@/hooks/use-toast";

interface CommandFormProps {
    initialData?: {
        id?: string;
        name: string;
        command: string;
        group?: string;
        enabled?: boolean;
    }
}

export function CommandForm({ initialData }: CommandFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(initialData?.name ?? "");
  const [command, setCommand] = useState(initialData?.command ?? "");
  const [group, setGroup] = useState(initialData?.group ?? "");
  const [enabled, setEnabled] = useState(initialData?.enabled ?? true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(initialData?.name ?? "");
    setCommand(initialData?.command ?? "");
    setGroup(initialData?.group ?? "");
    setEnabled(initialData?.enabled ?? true);
  }, [initialData?.name, initialData?.command, initialData?.group, initialData?.enabled]);

  const canSave = command.trim().startsWith("!") && (name.trim().length > 0 || command.trim().length > 0);

  const handleSubmit = async () => {
    if (!canSave) {
      toast({
        variant: "destructive",
        title: "Invalid command",
        description: "Command must start with ! (example: !cuddle)",
      });
      return;
    }
    setIsSaving(true);
    try {
      if (initialData?.id) {
        await updateCommandClient(initialData.id, {
          name: name.trim() || command.trim(),
          command: command.trim(),
          group: group.trim() || undefined,
          enabled,
        });
      } else {
        await createCommandClient({
          name: name.trim() || command.trim(),
          command: command.trim(),
          group: group.trim() || undefined,
          enabled,
        });
      }
      toast({ title: "Command saved" });
      router.push("/commands");
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Failed to save command",
        description: e?.message || String(e),
      });
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle>Command Details</CardTitle>
        <CardDescription>
          {initialData ? "Edit the details of your command." : "Create a new command from scratch."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="command-name">Command Name</Label>
            <Input
              id="command-name"
              placeholder="e.g., Cuddle"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="command-text">Command</Label>
            <Input
              id="command-text"
              placeholder="!cuddle"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="group">Group (Optional)</Label>
            <Input id="group" placeholder="Fun" value={group} onChange={(e) => setGroup(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Enabled</div>
              <div className="text-xs text-muted-foreground">Whether this command can trigger.</div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSubmit} disabled={!canSave || isSaving}>
          {isSaving ? "Saving..." : initialData ? "Save Changes" : "Create Command"}
        </Button>
      </CardFooter>
    </Card>
  );
}
