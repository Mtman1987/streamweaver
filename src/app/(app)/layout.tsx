import AppShell from '@/components/layout/app-shell';
import { OBSBridge } from '@/components/obs-bridge';
import { parseSessionCookie } from '@/lib/session-cookie';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { WorkspaceThemeProvider } from '@/components/workspace-theme-provider';
import { SpmtWorkspaceHost } from '@/components/spmt-workspace-host';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies();
  const session = parseSessionCookie(cookieStore.get('streamweaver-session')?.value);

  if (!session) redirect('/login');

  return (
    <WorkspaceThemeProvider>
      <AppShell>
        <OBSBridge />
        {children}
      </AppShell>
      <SpmtWorkspaceHost />
    </WorkspaceThemeProvider>
  );
}
