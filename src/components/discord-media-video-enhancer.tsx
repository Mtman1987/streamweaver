'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { DISCORD_MEDIA_MAX_FILE_BYTES, DISCORD_MEDIA_MAX_FILE_MB } from '@/lib/discord-media-limits';

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi']);
const MEDIA_ACCEPT = '.gif,.mp4,.webm,.mov,.m4v,.mkv,.avi,image/gif,video/*';

type MediaSlot = 'private-dm' | 'public-discord';

function slotForInput(input: HTMLInputElement): MediaSlot | null {
  const label = String(input.getAttribute('aria-label') || '').toLowerCase();
  if (label.includes('private dm')) return 'private-dm';
  if (label.includes('public discord')) return 'public-discord';
  return null;
}

function extensionOf(file: File): string {
  return String(file.name || '').split('.').pop()?.toLowerCase() || '';
}

function updateControlledInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function setTextIfChanged(element: HTMLElement | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function enhanceMediaInputs(root: ParentNode = document): void {
  const inputs = root.querySelectorAll<HTMLInputElement>('input[type="file"][aria-label*="Discord GIF"], input[type="file"][aria-label*="DM GIF"]');
  for (const input of inputs) {
    if (input.accept !== MEDIA_ACCEPT) input.accept = MEDIA_ACCEPT;
    const slot = slotForInput(input);
    const nextLabel = slot === 'private-dm'
      ? 'Upload private DM GIF or video'
      : slot === 'public-discord'
        ? 'Upload public Discord GIF or video'
        : '';
    if (nextLabel && input.getAttribute('aria-label') !== nextLabel) {
      input.setAttribute('aria-label', nextLabel);
    }
  }

  setTextIfChanged(
    root.querySelector<HTMLLabelElement>('label[for="private-dm-gif"]'),
    'Private DM / app private chat GIF URL (or upload a video)',
  );
  setTextIfChanged(
    root.querySelector<HTMLLabelElement>('label[for="public-discord-gif"]'),
    'Public Discord / embed GIF URL (or upload a video)',
  );
}

export function DiscordMediaVideoEnhancer() {
  const { toast } = useToast();
  const uploading = useRef(false);

  useEffect(() => {
    enhanceMediaInputs();
    const observer = new MutationObserver(() => enhanceMediaInputs());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const onChange = async (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
      const slot = slotForInput(input);
      const file = input.files?.[0];
      if (!slot || !file || !VIDEO_EXTENSIONS.has(extensionOf(file))) return;

      // Stop the legacy GIF-only React handler. This capture listener replaces
      // it only for video files; normal GIF uploads keep their existing path.
      event.stopImmediatePropagation();
      input.value = '';
      if (uploading.current) return;
      if (file.size > DISCORD_MEDIA_MAX_FILE_BYTES) {
        toast({
          variant: 'destructive',
          title: 'Video is too large',
          description: `Pick a video no larger than ${DISCORD_MEDIA_MAX_FILE_MB} MB.`,
        });
        return;
      }

      uploading.current = true;
      toast({
        title: 'Converting video to GIF',
        description: 'dsh-clip-worker is rendering the Discord media slot.',
      });
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('slot', slot);
        const response = await fetch('/api/discord-media', {
          method: 'POST',
          body: formData,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || `Upload failed: ${response.status}`);

        const mediaUrl = String(payload?.url || '').trim();
        if (!mediaUrl) throw new Error('The converted GIF URL was missing.');
        const targetId = slot === 'private-dm' ? 'private-dm-gif' : 'public-discord-gif';
        const target = document.getElementById(targetId);
        if (target instanceof HTMLInputElement) updateControlledInput(target, mediaUrl);

        const privateUrl = slot === 'private-dm'
          ? mediaUrl
          : String((document.getElementById('private-dm-gif') as HTMLInputElement | null)?.value || '');
        const publicUrl = slot === 'public-discord'
          ? mediaUrl
          : String((document.getElementById('public-discord-gif') as HTMLInputElement | null)?.value || '');
        const saveResponse = await fetch('/api/user-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            PRIVATE_DM_GIF_URL: privateUrl,
            PUBLIC_DISCORD_GIF_URL: publicUrl,
          }),
        });
        if (!saveResponse.ok) {
          const body = await saveResponse.json().catch(() => ({}));
          throw new Error(body?.error || 'The converted GIF could not be saved to this media slot.');
        }

        toast({
          title: slot === 'private-dm' ? 'Private DM video converted' : 'Public Discord video converted',
          description: 'The new GIF is saved and ready for embed controls.',
        });
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Video conversion failed',
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        uploading.current = false;
      }
    };

    document.addEventListener('change', onChange, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('change', onChange, true);
    };
  }, [toast]);

  return null;
}
