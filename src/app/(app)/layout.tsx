import AppShell from '@/components/layout/app-shell';
import { OBSBridge } from '@/components/obs-bridge';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AppShell>
      <OBSBridge />
      {children}
    </AppShell>
  );
}
