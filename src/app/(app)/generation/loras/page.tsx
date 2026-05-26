'use client';

import { useState } from 'react';
import { generationLoras } from '@/lib/generation-catalog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export default function GenerationLorasPage() {
  const { toast } = useToast();
  const [savingId, setSavingId] = useState('');

  async function applyLora(lora: string) {
    setSavingId(lora);
    try {
      const res = await fetch('/api/gen-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lora }),
      });
      if (!res.ok) throw new Error('save failed');
      toast({ title: 'LoRA selected', description: `Saved default LoRA: ${lora}` });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save default LoRA' });
    } finally {
      setSavingId('');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Generation LoRAs</h1>
        <p className="text-sm text-muted-foreground">Pick a default LoRA for tenant image generation settings.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {generationLoras.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="text-lg">{item.name}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {item.recommended ? <p className="text-xs text-muted-foreground">Recommended: {item.recommended}</p> : null}
              <Button onClick={() => applyLora(item.id)} disabled={savingId === item.id}>
                {savingId === item.id ? 'Saving...' : 'Use this LoRA'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
