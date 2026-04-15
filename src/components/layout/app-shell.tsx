"use client";

import AppSidebar from '@/components/layout/sidebar';
import Header from '@/components/layout/header';
import { SidebarInset } from '@/components/ui/sidebar';
import { LiveStreamersProvider } from '@/contexts/live-streamers-context';
import { useState, useEffect, lazy, Suspense } from 'react';

const LogPanel = lazy(() => import('@/components/logs/log-panel').then(m => ({ default: m.LogPanel })).catch(() => ({ default: () => null })));
const LogPanelProviderLazy = lazy(() => import('@/components/logs/log-panel-context').then(m => ({ default: m.LogPanelProvider })).catch(() => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> })));

export type UserProfile = {
  twitch?: {
    name: string;
    avatar: string;
  } | null,
  discord?: {
    name: string;
    avatar: string;
  } | null
}

export default function AppShell({
  children,
}: {
  children: React.ReactNode
}) {
  const [userProfile, setUserProfile] = useState<UserProfile>({});

  useEffect(() => {
    async function fetchUserProfile() {
        try {
            const response = await fetch('/api/user-profile');
            if (response.status === 401 || response.status === 404) {
              window.location.href = '/login';
              return;
            }
            if (response.ok) {
              const data = await response.json();
              setUserProfile(data);
            } else {
              console.error('Failed to fetch user profile');
              window.location.href = '/login';
            }
        } catch (error) {
            console.error('Error fetching user profile:', error);
            window.location.href = '/login';
        }
    }

    async function ensureConfigured() {
      try {
        const response = await fetch('/api/user-config', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        if (!data?.complete) {
          window.location.href = '/setup';
        }
      } catch {
        // ignore
      }
    }

    fetchUserProfile();
    ensureConfigured();
  }, []);

  return (
    <Suspense fallback={null}>
      <LogPanelProviderLazy>
        <LiveStreamersProvider>
          <AppSidebar userProfile={userProfile} />
          <SidebarInset className="bg-background">
            <Header />
            <main className="p-4 sm:px-6 sm:py-0 flex-1 flex flex-col">
                <div className="flex-1">
                    {children}
                </div>
                <Suspense fallback={null}>
                  <LogPanel />
                </Suspense>
            </main>
          </SidebarInset>
        </LiveStreamersProvider>
      </LogPanelProviderLazy>
    </Suspense>
  )
}
