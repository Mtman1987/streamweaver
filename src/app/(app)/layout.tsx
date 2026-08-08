import AppShell from '@/components/layout/app-shell';
import { OBSBridge } from '@/components/obs-bridge';
import { DiscordMediaVideoEnhancer } from '@/components/discord-media-video-enhancer';
import { parseSessionCookie } from '@/lib/session-cookie';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { WorkspaceThemeProvider } from '@/components/workspace-theme-provider';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies();
  const session = parseSessionCookie(cookieStore.get('streamweaver-session')?.value);

  // Signed sessions use a runtime-only Fly secret. This Node layout is the
  // authoritative page guard; Edge middleware never needs access to the secret.
  if (!session) redirect('/login');

  return (
    <WorkspaceThemeProvider>
      <AppShell>
        <OBSBridge />
        <DiscordMediaVideoEnhancer />
        {children}
      </AppShell>
    </WorkspaceThemeProvider>
  );
}
