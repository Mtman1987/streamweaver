'use client';

/**
 * Streamer.bot Import Component
 * Allows users to upload and import Streamer.bot actions/commands
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Upload, FileJson, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
}

interface ImportResults {
  actions: ImportResult;
  commands: ImportResult;
}

export function StreamerbotImporter() {
  const [actionsFile, setActionsFile] = useState<File | null>(null);
  const [commandsFile, setCommandsFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResults | null>(null);
  const { toast } = useToast();

  const handleImport = async () => {
    if (!actionsFile && !commandsFile) {
      toast({
        title: 'No files selected',
        description: 'Please select at least one file to import',
        variant: 'destructive',
      });
      return;
    }

    setImporting(true);
    setResults(null);

    try {
      const formData = new FormData();
      if (actionsFile) formData.append('actionsFile', actionsFile);
      if (commandsFile) formData.append('commandsFile', commandsFile);

      const response = await fetch('/api/import/streamerbot', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setResults(data.results);
        toast({
          title: 'Import successful!',
          description: `Imported ${data.results.actions.imported} actions and ${data.results.commands.imported} commands. Reloading...`,
        });
        
        // Reload the page after a short delay to show updated data
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        throw new Error(data.message || 'Import failed');
      }
    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileJson className="h-5 w-5" />
          Import from Streamer.bot
        </CardTitle>
        <CardDescription>
          Import your existing Streamer.bot actions and commands into StreamWeaver
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Actions File Upload */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Actions File</label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => document.getElementById('actions-file')?.click()}
              disabled={importing}
            >
              <Upload className="mr-2 h-4 w-4" />
              {actionsFile ? actionsFile.name : 'Choose actions.json'}
            </Button>
            <input
              id="actions-file"
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => setActionsFile(e.target.files?.[0] || null)}
              aria-label="Select actions.json file"
            />
            {actionsFile && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActionsFile(null)}
                disabled={importing}
              >
                Clear
              </Button>
            )}
          </div>
          {actionsFile && (
            <p className="text-xs text-muted-foreground">
              {(actionsFile.size / 1024).toFixed(2)} KB
            </p>
          )}
        </div>

        {/* Commands File Upload */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Commands File</label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => document.getElementById('commands-file')?.click()}
              disabled={importing}
            >
              <Upload className="mr-2 h-4 w-4" />
              {commandsFile ? commandsFile.name : 'Choose commands.json'}
            </Button>
            <input
              id="commands-file"
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => setCommandsFile(e.target.files?.[0] || null)}
              aria-label="Select commands.json file"
            />
            {commandsFile && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCommandsFile(null)}
                disabled={importing}
              >
                Clear
              </Button>
            )}
          </div>
          {commandsFile && (
            <p className="text-xs text-muted-foreground">
              {(commandsFile.size / 1024).toFixed(2)} KB
            </p>
          )}
        </div>

        {/* Import Button */}
        <Button
          onClick={handleImport}
          disabled={importing || (!actionsFile && !commandsFile)}
          className="w-full"
        >
          {importing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Import to StreamWeaver
            </>
          )}
        </Button>

        {/* Results */}
        {results && (
          <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              Import Completed
            </div>

            {results.actions.total > 0 && (
              <div className="space-y-1 text-sm">
                <div className="font-medium">Actions:</div>
                <div className="grid grid-cols-3 gap-2 text-muted-foreground">
                  <div>Imported: {results.actions.imported}</div>
                  <div>Skipped: {results.actions.skipped}</div>
                  <div>Total: {results.actions.total}</div>
                </div>
              </div>
            )}

            {results.commands.total > 0 && (
              <div className="space-y-1 text-sm">
                <div className="font-medium">Commands:</div>
                <div className="grid grid-cols-3 gap-2 text-muted-foreground">
                  <div>Imported: {results.commands.imported}</div>
                  <div>Skipped: {results.commands.skipped}</div>
                  <div>Total: {results.commands.total}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Help Text */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="space-y-2">
              <p className="font-medium">How to export from Streamer.bot:</p>
              <div className="text-xs space-y-1">
                <p>1. Open Streamer.bot application</p>
                <p>2. Go to Actions tab, right-click, select Export, save as actions.json</p>
                <p>3. Go to Commands tab, right-click, select Export, save as commands.json</p>
                <p>4. Upload the files here to import them</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
