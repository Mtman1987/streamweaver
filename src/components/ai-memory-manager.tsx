'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Trash2, CheckCircle, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function AIMemoryManager() {
  const [isClearing, setIsClearing] = useState(false);
  const [lastCleared, setLastCleared] = useState<Date | null>(null);
  const { toast } = useToast();

  const handleClearMemory = async () => {
    setIsClearing(true);
    
    try {
      const response = await fetch('/api/ai/clear-memory', {
        method: 'POST',
      });
      
      if (response.ok) {
        const data = await response.json();
        setLastCleared(new Date());
        toast({
          title: 'Memory Cleared',
          description: 'AI chat memory has been successfully cleared.',
        });
      } else {
        throw new Error('Failed to clear memory');
      }
    } catch (error) {
      console.error('Failed to clear AI memory:', error);
      toast({
        title: 'Error',
        description: 'Failed to clear AI memory. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          AI Memory Management
        </CardTitle>
        <CardDescription>
          Manage AI chat memory and handle content policy violations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Automatic Protection:</strong> AI memory is automatically cleared when content policy violations are detected.
            Use manual clearing only if needed for troubleshooting.
          </AlertDescription>
        </Alert>

        {lastCleared && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Memory last cleared: {lastCleared.toLocaleString()}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Button
            onClick={handleClearMemory}
            disabled={isClearing}
            variant="destructive"
            className="w-full"
          >
            {isClearing ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Clearing Memory...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Clear AI Memory
              </>
            )}
          </Button>
          
          <p className="text-xs text-muted-foreground">
            This will remove all conversation history and start fresh.
            The AI will no longer remember previous interactions.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}