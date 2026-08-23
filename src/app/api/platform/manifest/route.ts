import { NextResponse } from 'next/server';

const manifest = {
  manifestVersion: 'spmt.app-manifest/v1',
  id: 'streamweaver',
  name: 'StreamWeaver',
  description: 'Multi-tenant streaming automation, AI, voice, chat, overlay, and workflow runtime.',
  version: '0.2.0',
  launchUrl: 'https://streamweaver-new.fly.dev',
  healthUrl: 'https://streamweaver-new.fly.dev/api/health',
  registrySource: 'first-party',
  capabilities: [
    'automation',
    'commands',
    'ai-runtime',
    'tts',
    'shared-chat',
    'overlays',
    'pokemon',
    'signal',
    'companion',
  ],
  surfaces: ['dashboard', 'commands', 'chat', 'overlays', 'settings'],
  integration: {
    identity: 'connected',
    events: 'connected',
    commlink: 'native',
    athena: 'native',
    workspace: 'connected',
    sdk: 'connected',
  },
  developer: {
    sdkPackage: '@spmt/sdk',
    documentationUrl: 'https://streamweaver-new.fly.dev/developers',
    eventOwner: 'streamweaver',
    tenantIsolation: true,
  },
} as const;

export async function GET() {
  return NextResponse.json({
    ...manifest,
    buildSha: process.env.BUILD_SHA || 'development',
    generatedAt: new Date().toISOString(),
  });
}
