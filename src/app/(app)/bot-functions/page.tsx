'use client';

import Link from 'next/link';
import { ArrowRight, Bot, Image as ImageIcon, Languages, MessageSquareText, Music, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const publicFunctions = [
  {
    title: 'Chat commands',
    description: 'Browse the commands and interactive features available to viewers during a stream.',
    icon: MessageSquareText,
    href: '/commands',
    action: 'View commands',
  },
  {
    title: 'Live translation',
    description: 'Use multilingual chat support without exposing provider credentials or internal routing controls.',
    icon: Languages,
    href: '/translation',
    action: 'Open translation',
  },
  {
    title: 'Voice and TTS',
    description: 'Learn how StreamWeaver reads supported messages and events aloud on stream.',
    icon: Music,
    href: '/docs',
    action: 'Read the guide',
  },
  {
    title: 'Creative tools',
    description: 'See the viewer-facing image, avatar, and creative commands currently enabled for the channel.',
    icon: ImageIcon,
    href: '/commands',
    action: 'Explore creative commands',
  },
];

export default function BotFunctionsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <section className="relative overflow-hidden rounded-3xl border bg-card p-6 shadow-sm sm:p-10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10" aria-hidden="true" />
        <div className="relative max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-sm text-muted-foreground backdrop-blur">
            <Bot className="h-4 w-4" />
            StreamWeaver bot functions
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">What the bot can do for your stream</h1>
          <p className="text-base leading-7 text-muted-foreground sm:text-lg">
            This page now contains only viewer- and creator-safe feature information. Internal prompts, provider tuning,
            research controls, deployment tools, raw media slots, and developer diagnostics are managed in the secured Rotator console.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild>
              <Link href="/commands">
                Browse commands <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/docs">Open documentation</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {publicFunctions.map(({ title, description, icon: Icon, href, action }) => (
          <Card key={title} className="h-full">
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <CardTitle>{title}</CardTitle>
              <CardDescription className="leading-6">{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="ghost" className="px-0">
                <Link href={href}>
                  {action} <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 rounded-2xl border bg-muted/30 p-5 sm:grid-cols-[auto_1fr] sm:items-start">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="space-y-2">
          <h2 className="font-semibold">Safer by default</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Secrets, model configuration, system prompts, moderation policy, research sources, test utilities, and deployment controls are no longer rendered in the general StreamWeaver application.
          </p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            Public pages describe capabilities; the Rotator owns operations.
          </div>
        </div>
      </section>
    </div>
  );
}
