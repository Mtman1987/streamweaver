
"use client";

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CommandForm } from "../../command-form";
import { Button } from '@/components/ui/button';
import { deleteCommandClient, fetchCommandById } from '@/lib/client-commands';
import { useToast } from '@/hooks/use-toast';
import type { CommandDTO } from '@/lib/commands-store';

export default function EditCommandPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const commandId = useMemo(() => decodeURIComponent(name), [name]);
  const router = useRouter();
  const { toast } = useToast();

  const [command, setCommand] = useState<CommandDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const c = await fetchCommandById(commandId);
        if (!cancelled) setCommand(c);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load command.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [commandId]);

  const handleDelete = async () => {
    const ok = window.confirm('Delete this command?');
    if (!ok) return;
    try {
      await deleteCommandClient(commandId);
      toast({ title: 'Command deleted' });
      router.push('/commands');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: e?.message || String(e) });
    }
  };

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Edit Command</h1>
            <p className="text-muted-foreground">Update the command settings.</p>
          </div>
          <Button variant="destructive" onClick={handleDelete} disabled={isLoading}>
            Delete
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : error ? (
        <div className="text-sm text-destructive">{error}</div>
      ) : command ? (
        <CommandForm
          initialData={{
            id: command.id,
            name: command.name,
            command: command.command,
            group: command.group,
            enabled: command.enabled,
          }}
        />
      ) : (
        <div className="text-sm text-muted-foreground">Not found.</div>
      )}
    </div>
  );
}
