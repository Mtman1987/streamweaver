'use client';

import { useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, Download, FileJson, Check, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function CommunityPage() {
  const { toast } = useToast();
  const [commands, setCommands] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<'command' | 'action'>('command');

  const loadData = async () => {
    try {
      const [cmdRes, actRes] = await Promise.all([
        fetch('/api/commands'),
        fetch('/api/actions'),
      ]);
      if (cmdRes.ok) setCommands(await cmdRes.json());
      if (actRes.ok) {
        const data = await actRes.json();
        setActions(data.actions || data || []);
      }
      setLoaded(true);
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load data' });
    }
  };

  if (!loaded) loadData();

  const handleExport = (type: 'command' | 'action', item: any) => {
    const json = JSON.stringify(item, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}-${(item.name || item.command || 'export').replace(/[^a-zA-Z0-9]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `${type === 'command' ? 'Command' : 'Action'} exported`, description: item.name || item.command });
  };

  const handleExportAll = (type: 'commands' | 'actions') => {
    const data = type === 'commands' ? commands : actions;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `streamweaver-${type}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `All ${type} exported`, description: `${data.length} items` });
  };

  const handleImportClick = (type: 'command' | 'action') => {
    setImportType(type);
    fileInputRef.current?.click();
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      let imported = 0;
      for (const item of items) {
        const endpoint = importType === 'command' ? '/api/commands' : '/api/actions';
        const body = importType === 'command'
          ? { name: item.name || item.command || 'Imported', command: item.command || '!imported', group: item.group, enabled: item.enabled ?? true }
          : { name: item.name || 'Imported Action', group: item.group, enabled: item.enabled ?? false };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) imported++;
      }

      toast({ title: `Imported ${imported} ${importType}(s)`, description: `From ${file.name}` });
      setLoaded(false); // trigger refresh
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Import failed', description: err.message || 'Invalid JSON file' });
    }

    e.target.value = '';
  };

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold">Community Sharing</h1>
        <p className="text-muted-foreground mt-1">
          Export your commands and actions as JSON files to share with other streamers, or import theirs.
        </p>
      </div>

      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileImport} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Commands ({commands.length})</CardTitle>
                <CardDescription>Your bot commands</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => handleImportClick('command')}>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Import
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleExportAll('commands')}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export All
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {commands.map((cmd: any) => (
                <div key={cmd.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{cmd.name || cmd.command}</p>
                    <p className="text-xs text-muted-foreground font-mono">{cmd.command}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => handleExport('command', cmd)}>
                    <FileJson className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {commands.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No commands yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Actions ({actions.length})</CardTitle>
                <CardDescription>Your automation actions</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => handleImportClick('action')}>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Import
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleExportAll('actions')}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export All
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {actions.map((action: any) => (
                <div key={action.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{action.name}</p>
                    <p className="text-xs text-muted-foreground">{action.group || 'No group'}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => handleExport('action', action)}>
                    <FileJson className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {actions.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No actions yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
