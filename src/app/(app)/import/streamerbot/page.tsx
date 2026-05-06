'use client';

/**
 * Streamer.bot Import Page
 * View and import Streamer.bot data
 */

import { StreamerbotImporter } from '@/components/streamerbot-importer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileJson, Settings, Command, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function StreamerbotImportPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
      </div>

      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold mb-2">Streamer.bot Integration</h1>
          <p className="text-muted-foreground">
            Import your existing Streamer.bot actions and commands to continue using them in StreamWeaver
          </p>
        </div>

        {/* Import Component */}
        <StreamerbotImporter />

        {/* Info Cards */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings className="h-5 w-5" />
                Actions
              </CardTitle>
              <CardDescription>
                Automated workflows triggered by events
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>Actions can be triggered by:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Follows, Subscriptions, Raids</li>
                <li>Channel Points Redemptions</li>
                <li>Chat Commands</li>
                <li>Timers and Hotkeys</li>
                <li>OBS Events</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Command className="h-5 w-5" />
                Commands
              </CardTitle>
              <CardDescription>
                Chat commands for viewers and moderators
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>Commands include:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Custom permissions and cooldowns</li>
                <li>Regular expressions support</li>
                <li>Command aliases</li>
                <li>User and global cooldowns</li>
                <li>Group-based access control</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* What Gets Imported */}
        <Card>
          <CardHeader>
            <CardTitle>What Gets Imported?</CardTitle>
            <CardDescription>
              Understanding the import process
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium mb-2">✅ Preserved:</h4>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                <li>Action names, descriptions, and groups</li>
                <li>Trigger configurations</li>
                <li>SubAction sequences and settings</li>
                <li>Command strings and aliases</li>
                <li>Permissions and cooldowns</li>
                <li>Enabled/disabled states</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-2">🔄 Converted:</h4>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                <li>Streamer.bot-specific types to StreamWeaver equivalents</li>
                <li>C# code blocks (preserved but may need review)</li>
                <li>OBS and external integrations</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-2">⚠️ May Need Review:</h4>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                <li>Custom C# code should be converted to JavaScript</li>
                <li>File paths (sound files, overlays, etc.)</li>
                <li>Complex variable manipulations</li>
                <li>Third-party plugin integrations</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Next Steps */}
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
          <CardHeader>
            <CardTitle className="text-green-900 dark:text-green-100">
              After Importing
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-green-900 dark:text-green-100 space-y-2">
            <p>Once your data is imported:</p>
            <ol className="list-decimal list-inside space-y-1 ml-4">
              <li>Review your imported actions in the Actions panel</li>
              <li>Test commands in the Commands panel</li>
              <li>Update file paths for sounds and overlays</li>
              <li>Convert C# code blocks to JavaScript if needed</li>
              <li>Reconfigure any third-party integrations</li>
            </ol>
            <div className="mt-4 flex gap-2">
              <Link href="/actions">
                <Button variant="outline" size="sm">
                  View Actions
                </Button>
              </Link>
              <Link href="/commands">
                <Button variant="outline" size="sm">
                  View Commands
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
