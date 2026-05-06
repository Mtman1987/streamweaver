"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PlusCircle } from "lucide-react";
import { createActionClient } from "@/lib/client-actions";
import { useToast } from "@/hooks/use-toast";

export default function NewActionPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [group, setGroup] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await createActionClient({
        name: name.trim(),
        group: group.trim() || undefined,
        enabled,
      });
      
      toast({
        title: "Action created",
        description: "Your action has been created successfully.",
      });
      
      router.push("/actions");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to create action",
        description: error?.message || "Something went wrong.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create New Action</CardTitle>
          <CardDescription>Create the action container. You’ll link commands and build the flow in Active Commands.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Action Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome Action"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this action do?"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="group">Group (Optional)</Label>
              <Input
                id="group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="Chat Games"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="enabled">Enabled</Label>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting || !name.trim()}>
                {isSubmitting ? "Creating..." : "Create Action"}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push("/actions")}>
                Cancel
              </Button>
            </div>

            <div className="rounded-md border p-4 text-sm text-muted-foreground">
              Next: go to <span className="font-medium">Active Commands</span> and link a command as a trigger, then build the full flow.
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}