'use client';

import { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';

interface OverlayInfo {
  name: string;
  path: string;
  absoluteUrl?: string;
  description: string;
  recommended?: string;
  xpnCompatible?: boolean;
  scopes?: string[];
}

const OVERLAYS: OverlayInfo[] = [
  {
    name: 'SpaceMountain Personal / Universal Overlay',
    path: '/',
    absoluteUrl: 'https://spacemountain.live/?desktopOverlay=1',
    description: 'Account-saved personal canvas shared with SpaceMountain Companion. Includes independently movable widgets and embeds, visibility, opacity, interaction modes, parallax opt-in, and layer order.',
    recommended: 'Match your display or OBS canvas',
    xpnCompatible: false,
    scopes: ['identity:read', 'overlay:control', 'workspace:read'],
  },
  {
    name: 'Featured Live Chat Message',
    path: '/overlay/shared-chat-featured',
    description: 'Transparent selected-message output from the Live Chat Dock, including platform, channel, sender, donation/member labels, duration, and queue advance.',
    recommended: '1920x1080',
    xpnCompatible: false,
  },
  {
    name: 'TTS Player',
    path: '/tts-player',
    description: 'Text-to-speech audio playback with avatar animation. Add as a browser source in OBS — click the page once to enable audio.',
    recommended: '800x600',
  },
  {
    name: 'Shoutout Player',
    path: '/shoutout-player',
    description: 'Displays walk-on shoutouts with Twitch clips and AI greetings. Controlled automatically by the bot.',
    recommended: '1920x1080',
  },
  {
    name: 'BRB Clip Player',
    path: '/brb-player',
    description: 'Plays random clips during BRB breaks. Triggered by !brb command. Add this as a browser source in your BRB scene. Set your scene names in Integrations → OBS Scene Names.',
    recommended: '1920x1080',
  },
  {
    name: 'Pokemon Pack Overlay',
    path: '/pokemon-pack-overlay',
    description: 'Animated pack opening experience when viewers redeem !pack.',
    recommended: '1920x1080',
  },
  {
    name: 'Pokemon Collection Overlay',
    path: '/pokemon-collection-overlay',
    description: 'Shows a viewer\'s card collection when they use !collection.',
    recommended: '1920x1080',
  },
  {
    name: 'Pokemon Trade Overlay',
    path: '/pokemon-trade-overlay',
    description: 'Animated trade sequence when two viewers swap cards.',
    recommended: '1920x1080',
  },
  {
    name: 'Gym Battle Overlay',
    path: '/gym-battle-overlay',
    description: 'Pokemon gym battle animations for !challenge and !attack commands.',
    recommended: '1920x1080',
  },
  {
    name: 'Classic Gamble Overlay',
    path: '/classic-gamble-overlay',
    description: 'Visual slot-machine style overlay for the !gamble command.',
    recommended: '800x600',
  },
  {
    name: 'Gamble Overlay',
    path: '/gamble-overlay',
    description: 'Alternative gamble display overlay.',
    recommended: '800x600',
  },
  {
    name: 'Partner Check-In',
    path: '/partner-checkin',
    description: 'Displays partner check-in animations when viewers use the partner redeem.',
    recommended: '1920x1080',
  },
];

const XPN_BASE_URL = 'https://x.la';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied!' : 'Copy URL'}
    </button>
  );
}

export default function OverlayUrlsPage() {
  const [baseUrl, setBaseUrl] = useState('');
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    // Fetch tenant from server since cookie is httpOnly
    fetch('/api/user-profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.tenantId) setTenantId(data.tenantId);
        else if (data?.twitch?.id) setTenantId(data.twitch.id);
      })
      .catch(() => {});
  }, []);

  function buildUrl(overlay: OverlayInfo): string {
    const url = new URL(overlay.absoluteUrl || overlay.path, baseUrl);
    if (tenantId) url.searchParams.set('tenant', tenantId);
    if (overlay.scopes?.length) url.searchParams.set('scopes', overlay.scopes.join(','));
    return url.toString();
  }

  function buildXpnUrl(index: number): string {
    if (!tenantId) return `${XPN_BASE_URL}/xpn/overlay/__TENANT_ID__/${index}`;
    return `${XPN_BASE_URL}/xpn/overlay/${tenantId}/${index}`;
  }

  if (!baseUrl) return null;

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold">Overlay URLs</h1>
        <p className="text-muted-foreground mt-1">
          Copy these URLs into OBS browser sources or SpaceMountain Companion. Each URL includes your tenant ID so overlays only show your stream's events.
        </p>
        {!tenantId && (
          <p className="text-sm text-yellow-500 mt-2">
            ⚠️ No tenant session detected — URLs won't be tenant-scoped. Try refreshing or logging in again.
          </p>
        )}
      </div>

      <div className="grid gap-4">
        {OVERLAYS.map((overlay, idx) => {
          const url = buildUrl(overlay);
          const xpnUrl = buildXpnUrl(idx + 1);
          return (
            <div
              key={overlay.path}
              className="rounded-lg border bg-card p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">{overlay.name}</h3>
                  <p className="text-sm text-muted-foreground">{overlay.description}</p>
                  {overlay.recommended && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Recommended size: {overlay.recommended}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-accent transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Preview
                  </a>
                </div>
              </div>

              {/* Standard URL */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Standard URL (OBS)</span>
                  <CopyButton text={url} />
                </div>
                <div className="bg-muted rounded px-3 py-2">
                  <code className="text-xs break-all select-all">{url}</code>
                </div>
              </div>

              {overlay.xpnCompatible !== false && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">XPN / Lightstream URL</span>
                    <CopyButton text={xpnUrl} />
                  </div>
                  <div className="bg-muted rounded px-3 py-2">
                    <code className="text-xs break-all select-all">{xpnUrl}</code>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
